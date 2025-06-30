#define _GNU_SOURCE
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <fcntl.h> 
#include <poll.h>
#include <errno.h>
#include <inttypes.h>
#include <time.h>
#include <signal.h>
#include <stdatomic.h>
#include <string.h>

#include "config.h"
#include "sensor_buffer.h"
#include "connection_manager.h"
#include "data_manager.h"
#include "database_manager.h"
#include "tcpsock.h"
#include "dplist.h"

#define MAIN_PROCESS_THREAD_NR 3
// define as 1 to drop existing table, 0 to keep existing table
#define DB_FLAG 0

// functions
void* connmgr_th(void* arg);
void* datamgr_th(void* arg);
void* sensor_db_th(void* arg);

int print_help();
void handle_signal(int sig, siginfo_t *siginfo, void *context);
void cleanup_and_exit();
// thread variables
pthread_cond_t data_cond;
pthread_mutex_t datamgr_lock;
int* data_mgr;

pthread_cond_t db_cond;
pthread_mutex_t db_lock;
int* data_sensor_db;

pthread_rwlock_t connmgr_lock;
bool* connmgr_working;

pthread_mutex_t fifo_mutex;

pthread_mutex_t log_mutex = PTHREAD_MUTEX_INITIALIZER;
int* fifo_fd = 0;
int log_sequence_number = 0;

static atomic_bool stop_requested = false;
// create the threads
pthread_t threads[MAIN_PROCESS_THREAD_NR];

sbuffer_t* buffer;

int main(int argc, char* argv[]){
    // check if port_number arguments passed
    if(argv[1] == NULL) return print_help();

    //get the port number
    int port_number = atoi(argv[1]);
 
#ifdef DEBUG
    printf("INITIALIZING SENSOR GATEWAY\n");
#endif
    
    // initialize all the variables
    data_mgr = malloc(sizeof(int));
    data_sensor_db = malloc(sizeof(int));
    connmgr_working = malloc(sizeof(bool));


    *data_mgr = 0;
	  *data_sensor_db = 0;
	  *connmgr_working = true;
 
      struct sigaction sa;
      memset(&sa, 0, sizeof(sa));
      sa.sa_sigaction = handle_signal;
      sa.sa_flags = SA_SIGINFO;
      sigaction(SIGINT, &sa, NULL);
      sigaction(SIGTERM, &sa, NULL);
      
    if (sigaction(SIGINT, &sa, NULL) == -1) {
        printf("sigaction");
        exit(EXIT_FAILURE);
    }
    
    // initialize the buffer
    if (sbuffer_init(&buffer) != SBUFFER_SUCCESS) {
        printf("[ERROR] Could not initialize shared buffer\n");
        exit(EXIT_FAILURE);
    }

    // initialize the pthreads
    pthread_cond_init(&data_cond, NULL);
    pthread_mutex_init(&datamgr_lock, NULL);
    
    pthread_cond_init(&db_cond, NULL);
    pthread_mutex_init(&db_lock, NULL);

    pthread_rwlock_init(&connmgr_lock, NULL);    
    pthread_mutex_init(&fifo_mutex, NULL);

#ifdef DEBUG
    printf("INITIALIZING THREADS\n");
#endif

    // connmgr thread
    pthread_create(&threads[0], NULL, &connmgr_th, &port_number);
    // database thread
    READ_TH_ENUM DBT = DB_THREAD;
    pthread_create(&threads[1], NULL, &sensor_db_th, &DBT);
    // datamgr thread
    READ_TH_ENUM DMT = DATAMGR_THREAD;
    pthread_create(&threads[2], NULL, &datamgr_th, &DMT);

    // join all the threads after they are done
    for(int i = 0; i < MAIN_PROCESS_THREAD_NR; i++)
        pthread_join(threads[i], NULL);

#ifdef DEBUG
    printf("JOINED THREADS\n");
#endif

    // destroy the threads
    pthread_cond_destroy(&data_cond);
    pthread_mutex_destroy(&datamgr_lock);
    
    pthread_cond_destroy(&db_cond);
    pthread_mutex_destroy(&db_lock);

    pthread_rwlock_destroy(&connmgr_lock);    
    pthread_mutex_destroy(&fifo_mutex);




    cleanup_and_exit();


#ifdef DEBUG
    printf("CLOSING SENSOR GATEWAY\n");
#endif
    return 0;
}

void main_init_thread(config_thread_t* config_thread){
    config_thread->data_cond = &data_cond;
    config_thread->datamgr_lock = &datamgr_lock;
    config_thread->data_mgr = data_mgr;
    
    config_thread->db_cond = &db_cond;
    config_thread->db_lock = &db_lock;
    config_thread->data_sensor_db = data_sensor_db;

    config_thread->connmgr_lock = &connmgr_lock;
    config_thread->connmgr_working = connmgr_working;

    config_thread->fifo_mutex = &fifo_mutex;
    config_thread->fifo_fd = fifo_fd;
    config_thread->log_mutex = &log_mutex;
}

void* connmgr_th(void* arg){
    int port_number = *((int*) arg);
    config_thread_t connmgr_config_thread;
    main_init_thread(&connmgr_config_thread);

    connmgr_init(&connmgr_config_thread);
    connmgr_listen(port_number, &buffer);

#ifdef DEBUG
    printf(RED_CLR"CLOSING CONNMGR_THR\n"OFF_CLR);
#endif
    return NULL;
}

void* datamgr_th(void* arg){
    FILE* fp_sensor_map = fopen("room_sensor.map", "r");
    config_thread_t datamgr_config_thread;
    main_init_thread(&datamgr_config_thread);

    datamgr_init(&datamgr_config_thread);
    datamgr_parse_sensor_files(fp_sensor_map, &buffer);
    datamgr_free();
    fclose(fp_sensor_map);
    
#ifdef DEBUG
    printf(RED_CLR"CLOSING DATAMGR_THR\n"OFF_CLR);
#endif
    return NULL;
}

void* sensor_db_th(void* arg){
    // initialize the variables for the sensor_db thread
    config_thread_t sensor_db_config_thread;
    main_init_thread(&sensor_db_config_thread);

    sensor_db_init(&sensor_db_config_thread);
    DBCONN* conn = init_connection(DB_FLAG);
    sensor_db_listen(conn, &buffer);
    disconnect(conn);
#ifdef DEBUG
    printf(RED_CLR"CLOSING DB_THR\n"OFF_CLR);
#endif
    return NULL;
}

int print_help(){
    printf("USE THIS PROGRAMME WITH A COMMAND LINE OPTION: \n");
    printf("\t%-15s : TCP SERVER PORT NUMBER\n", "\'SERVER PORT\'");
    return -1;
}

void cleanup_and_exit() {
    printf(RED_CLR"[INFO] Cleaning up resources...\n"OFF_CLR);
        // free the threads
    free(data_mgr);
    free(data_sensor_db);
    free(connmgr_working);
    if (buffer != NULL) {
        sbuffer_free(&buffer);
    }
    exit(EXIT_SUCCESS);
}

void handle_signal(int sig, siginfo_t *siginfo, void *context) {
    (void)siginfo;
    (void)context;
    if (sig == SIGINT || sig == SIGTERM) {
        stop_requested = true;
        printf("\n[INFO] Signal %d received. Stopping gracefully...\n", sig);
        for (int i = 0; i < MAIN_PROCESS_THREAD_NR; i++) {
          pthread_cancel(threads[i]);  
        }
    }
    
}