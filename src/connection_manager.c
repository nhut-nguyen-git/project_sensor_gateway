
#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>
#include <poll.h>
#include "dplist.h"
#include "connection_manager.h"
#include "config.h"
#include "sensor_buffer.h"
#include <fcntl.h>
#include <unistd.h>
#include <pthread.h>
#include "logger.h"

typedef struct pollfd pollfd_t;

typedef struct{
	pollfd_t file_d;
	sensor_id_t sensor_id;
	tcpsock_t* socket_id;
	sensor_ts_t last_modified;
} poll_info_t;

// dpl_create functions
void* element_copy(void* element);
void element_free(void** element);
int element_compare(void* x, void* y);

// helper functions
int connmgr_add_sensor(poll_info_t** poll_at_index, int* list_size);
int connmgr_add_sensor_data(sbuffer_t** buffer, poll_info_t** poll_at_index, sensor_data_t* sensor_data);
void connmgr_remove_sensor(int* list_size, int index, poll_info_t** poll_at_index, poll_info_t* poll_server);
void connmgr_close_connection(int port_number, poll_info_t** poll_at_index, poll_info_t* poll_server, FILE* fp_sensor_data_text);
void connmgr_update_threads();
void connmgr_close_threads();

// global variables
static dplist_t* dpl_connections;
// multithreading variables
static pthread_cond_t* data_cond;
static pthread_mutex_t* datamgr_lock;
static int* data_mgr;

static pthread_cond_t* db_cond;
static pthread_mutex_t* db_lock;
static int* data_sensor_db;

static pthread_rwlock_t* connmgr_lock;
static bool* connmgr_working;

static pthread_mutex_t* fifo_mutex;
static pthread_mutex_t* log_mutex;
static int* fifo_fd;

void connmgr_init(config_thread_t* config_thread){
	data_cond = config_thread->data_cond;
	datamgr_lock = config_thread->datamgr_lock;
	data_mgr = config_thread->data_mgr;

	db_cond = config_thread->db_cond;
	db_lock = config_thread->db_lock;
	data_sensor_db = config_thread->data_sensor_db;

	connmgr_lock = config_thread->connmgr_lock;
	connmgr_working = config_thread->connmgr_working;

	fifo_fd = config_thread->fifo_fd;
	fifo_mutex = config_thread->fifo_mutex;
	log_mutex = config_thread->log_mutex;
}


void connmgr_listen(int port_number, sbuffer_t** buffer){
#ifdef DEBUG
	printf(PURPLE_CLR "CONNMGR: NEW CONNMGR.\n" OFF_CLR);
#endif
	// create and initialize dpl_connections
	dpl_connections = dpl_create(element_copy, element_free, element_compare);

	// open file 
	FILE* fp_sensor_data_text = fopen("sensor_data_recv", "w");

	//open tcp socket
	tcpsock_t* socket;
	if(tcp_passive_open(&socket, port_number) != TCP_NO_ERROR) printf("CANNOT CREATE SERVER\n"), exit(EXIT_FAILURE);
	// get the socket descriptor
	pollfd_t pollfd;
	if(tcp_get_sd(socket, &(pollfd.fd)) != TCP_NO_ERROR) printf("SOCKET NOT BOUND\n"), exit(EXIT_FAILURE);

	// start server
	poll_info_t poll_server = {
		.last_modified = time(NULL), // last event in server
		.socket_id = socket,
		.file_d = pollfd,
	};

	// only listen to incoming 
	poll_server.file_d.events = POLLIN;

	// add the poll_server as the first index 
	dpl_connections = dpl_insert_at_index(dpl_connections, &poll_server, 0, true);

	// get size of list
	int list_size = dpl_size(dpl_connections);
	int index = 0;
	while(*connmgr_working){
		// iterate through the list and check their polls
		if(index == list_size) index = 0;

		// get the poll_info_t at the index
		poll_info_t* poll_at_index = dpl_get_element_at_index(dpl_connections, index);

		// get the values
		int poll_nr = poll(&(poll_at_index->file_d), 1, TIMEOUT);
		short poll_events = poll_at_index->file_d.revents;
		long timeout_ts = time(NULL) - TIMEOUT;

		// in index == 0 we get notified about new connections 
		if(poll_nr > 0 && poll_events == POLLIN && index == 0)
			if(connmgr_add_sensor(&poll_at_index, &list_size) != TCP_NO_ERROR) continue;

		// in index > 0 we get notified about new sensor data
		if(poll_nr > 0 && poll_events == POLLIN && index > 0){
			// save the data in the sensor_data
			sensor_data_t sensor_data;

			// add it in the buffer
			if(connmgr_add_sensor_data(buffer, &(poll_at_index), &sensor_data) != TCP_NO_ERROR){
				// if error remove the sensor
				connmgr_remove_sensor(&list_size, index, &poll_at_index, &poll_server);
				continue;
			}

			// update the datamgr and db threads
			connmgr_update_threads();

			// print it in the text file
			fprintf(fp_sensor_data_text, "ID: %u   VAL: %f   TIME: %ld\n",
				sensor_data.id, sensor_data.value, sensor_data.ts);
#ifdef DEBUG
			printf(PURPLE_CLR "CONNMGR: ID: %u   VAL: %f   TIME: %ld\n"OFF_CLR,
				sensor_data.id, sensor_data.value, sensor_data.ts);
#endif
		}

		// REMOVE THE SENSOR IF:
		// not sent data in TIMEOUT seconds || a POLLHUP signal
		if((poll_at_index->last_modified < timeout_ts && index > 0) || poll_events == POLLHUP)
			connmgr_remove_sensor(&list_size, index, &poll_at_index, &poll_server);


		// STOP THE CONNMGR IF:
		// no sensors in the list && TIMEOUT seconds have passed
		if(list_size == 1 && poll_server.last_modified < timeout_ts){
			connmgr_close_connection(port_number, &poll_at_index, &poll_server, fp_sensor_data_text);
			break;
		}

		index++;
	}
#ifdef DEBUG
	printf(PURPLE_CLR "CLOSING CONNMGR.\n" OFF_CLR);
#endif
}


void connmgr_free(){
	dpl_free(&dpl_connections, true);
}

void connmgr_close_connection(int port_number, poll_info_t** poll_at_index, poll_info_t* poll_server, FILE* fp_sensor_data_text){
	connmgr_close_threads();
	
 
     if ((*poll_at_index)->socket_id != NULL) {
        tcp_close(&((*poll_at_index)->socket_id));
        (*poll_at_index)->socket_id = NULL;
    }
    

  log_message(LOG_LEVEL_INFO, "ConnMgr/Thread-1", "CLOSED CONNECTION MANAGER : %d", port_number);
  
	    if (poll_server->socket_id != NULL) {
        tcp_close(&(poll_server->socket_id));
        poll_server->socket_id = NULL;
    }
	fclose(fp_sensor_data_text);
	connmgr_free();
}


void connmgr_remove_sensor(int* list_size, int index, poll_info_t** poll_at_index, poll_info_t* poll_server){
#ifdef DEBUG
	printf(PURPLE_CLR "CLOSED CONNECTION SENSOR ID: %d\n"OFF_CLR, (*poll_at_index)->sensor_id);
#endif
	// remove the sensor
	
 
 log_message(LOG_LEVEL_INFO, "ConnMgr/Thread-1", "CLOSED CONNECTION SENSOR ID: %d", (*poll_at_index)->sensor_id);
 
	    if (poll_server->socket_id != NULL) {
        tcp_close(&(poll_server->socket_id));
        poll_server->socket_id = NULL;
    }
	dpl_connections = dpl_remove_at_index(dpl_connections, index, true);
	(*list_size)--; // decrement the list size

	// update the last modified time of the poll_server
	poll_server->last_modified = time(NULL);
}
int connmgr_add_sensor(poll_info_t** poll_at_index, int* list_size){
	tcpsock_t* new_socket;
	if(tcp_wait_for_connection((*poll_at_index)->socket_id, &new_socket) != TCP_NO_ERROR){
#ifdef DEBUG
		printf(PURPLE_CLR "ERROR WAITING TCP CONNECTION.\n" OFF_CLR);
#endif
		return TCP_CONNECTION_CLOSED;
	}

	pollfd_t new_fd;
	if(tcp_get_sd(new_socket, &(new_fd.fd)) != TCP_NO_ERROR){
#ifdef DEBUG
		printf(PURPLE_CLR "ERROR GETTING TCP SD.\n" OFF_CLR);
#endif
		return TCP_SOCKET_ERROR;
	}

	// initialise the sensor
	poll_info_t insert_sensor = {
		.last_modified = time(NULL),
		.socket_id = new_socket,
		.file_d = new_fd
	};

	//also listen if the sensor quits
	insert_sensor.file_d.events = POLLIN | POLLHUP;

	// insert the sensor in the list
	dpl_connections = dpl_insert_at_index(dpl_connections, &insert_sensor, dpl_size(dpl_connections), true);
	(*list_size)++; //update list_size
	return TCP_NO_ERROR;
}

int connmgr_add_sensor_data(sbuffer_t** buffer, poll_info_t** poll_at_index, sensor_data_t* sensor_data){

	// get the buf_size
	int sit = (int) sizeof(sensor_id_t);
	int sdt = (int) sizeof(sensor_value_t);
	int stt = (int) sizeof(sensor_ts_t);

	//receive the data
	if(tcp_receive((*poll_at_index)->socket_id, &(sensor_data->id), &sit) != TCP_NO_ERROR){
#ifdef DEBUG
		printf(PURPLE_CLR "ERROR RECEIVING TCP DATA.\n" OFF_CLR);
#endif
		return TCP_SOCKET_ERROR;
	}
	tcp_receive((*poll_at_index)->socket_id, &(sensor_data->value), &sdt);
	tcp_receive((*poll_at_index)->socket_id, &(sensor_data->ts), &stt);

#ifdef DEBUG
	printf(PURPLE_CLR "CONNMGR: NEW DATA RECEIVED.\n" OFF_CLR);
#endif
	// update the ID and log event if this is the first data from this sensor
	if((*poll_at_index)->sensor_id != sensor_data->id){

		// update the sensor ID and log the event
		(*poll_at_index)->sensor_id = sensor_data->id;
   //write log 
   log_message(LOG_LEVEL_INFO, "ConnMgr/Thread-1", "NEW CONNECTION SENSOR ID: %d", (*poll_at_index)->sensor_id);
   
   
#ifdef DEBUG
		printf(PURPLE_CLR "NEW CONNECTION SENSOR ID: %d\n"OFF_CLR, (*poll_at_index)->sensor_id);
#endif
	}

	//update the poll_at_index time
	(*poll_at_index)->last_modified = sensor_data->ts;

	if(sbuffer_insert(*buffer, sensor_data) != SBUFFER_SUCCESS)
		printf("CONNMGR: SBUFFER ERROR\n");
	return TCP_NO_ERROR;
}

void connmgr_update_threads(){
	// lock the mutex
	pthread_mutex_lock(datamgr_lock);
	pthread_mutex_lock(db_lock);

	// update the number of data in the buffer
	(*data_sensor_db)++;
	(*data_mgr)++;
	// unlock the mutex
	pthread_mutex_unlock(datamgr_lock);
	pthread_mutex_unlock(db_lock);

	// let the other threads know there is data to read
	pthread_cond_broadcast(db_cond);
	pthread_cond_broadcast(data_cond);
}

void connmgr_close_threads(){
	// close the connmgr
	pthread_rwlock_wrlock(connmgr_lock);
	*connmgr_working = false;
	pthread_rwlock_unlock(connmgr_lock);

	// lock the mutex
	pthread_mutex_lock(datamgr_lock);
	pthread_mutex_lock(db_lock);

	// update the number of data in the buffer
	(*data_mgr) = -1;
	(*data_sensor_db) = -1;

	// unlock the mutex
	pthread_mutex_unlock(datamgr_lock);
	pthread_mutex_unlock(db_lock);

	// let the other threads know there is data to read
	pthread_cond_broadcast(db_cond);
	pthread_cond_broadcast(data_cond);
}

void* element_copy(void* element){
	poll_info_t* src = (poll_info_t*) element;
	poll_info_t* copy = malloc(sizeof(poll_info_t));
	copy->file_d = src->file_d;
	copy->sensor_id = src->sensor_id;
	copy->socket_id = src->socket_id;
	copy->last_modified = src->last_modified;
	return copy;
}

void element_free(void **element) {
    if (element == NULL || *element == NULL) return;

    poll_info_t *info = (poll_info_t *)(*element);

    // Ch? close socket n?u chua b? d�ng
    if (info->socket_id != NULL) {
        tcp_close(&(info->socket_id));
        info->socket_id = NULL;
    }

    free(info);
    *element = NULL;
}

int element_compare(void* x, void* y){
	sensor_id_t x_id = *(sensor_id_t*) x;
	sensor_id_t y_id = ((poll_info_t*) y)->sensor_id;
	return (x_id == y_id) ? 0 : ((x_id > y_id) ? 1 : -1);
}

