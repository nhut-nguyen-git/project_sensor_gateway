
#define _GNU_SOURCE

#include <stdlib.h>
#include <stdio.h>
#include "config.h"
#include "sensor_buffer.h"
#include "dplist.h"
#include "data_manager.h"
#include "logger.h"

// definition of error codes
#define DPLIST_NO_ERROR 0
#define DPLIST_MEMORY_ERROR 1 // error due to mem alloc failure
#define DPLIST_INVALID_ERROR 2 //error due to a list operation applied on a NULL list 
#define ERROR_NULL_POINTER 3


// global variables
static dplist_t* sensor_list;

// helper methods

void datamgr_read_sensor_map(FILE* fp_sensor_map);
void datamgr_add_sensor_data(sensor_data_t* new_data);

// methods for dpl_create
void sensor_free(void** element);
void* sensor_copy(void* element);
int sensor_compare(void* x, void* y);

// global variables
static dplist_t* sensor_list;

static pthread_cond_t* data_cond;
static pthread_mutex_t* datamgr_lock;
static int* data_mgr;

static pthread_cond_t* db_cond;
static pthread_mutex_t* db_lock;
static int* data_sensor_db;

static pthread_rwlock_t* connmgr_lock;
static bool* connmgr_working;

static pthread_mutex_t* fifo_mutex;
static int* fifo_fd;

void datamgr_init(config_thread_t* config_thread){
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
}

void datamgr_parse_sensor_files(FILE* fp_sensor_map, sbuffer_t** sbuffer){
#ifdef DEBUG
    printf(GREEN_CLR "DATAMGR: INITIATING DATAMGR.\n"OFF_CLR);
#endif
    // initialize the sensor_list
    sensor_list = dpl_create(sensor_copy, sensor_free, sensor_compare);

    // read the sensor_map file
    datamgr_read_sensor_map(fp_sensor_map);

    // parse sensor_data, and insert it to the appropriate sensor
    while(*connmgr_working){
        pthread_mutex_lock(datamgr_lock);
        while((*data_mgr) == 0){
            pthread_cond_wait(data_cond, datamgr_lock);
        #ifdef DEBUG
            printf(GREEN_CLR "DATAMGR: WAITING FOR DATA.\n" OFF_CLR);
        #endif
            if (!*connmgr_working) {
            pthread_mutex_unlock(datamgr_lock);
            return;
            }
        }
        if(*connmgr_working == false){
            pthread_mutex_unlock(datamgr_lock);
            break;
        }

        pthread_mutex_unlock(datamgr_lock);

        // copy the data
        sensor_data_t new_data;
        int res = sbuffer_remove(*sbuffer, &new_data, DATAMGR_THREAD);
        if( res != SBUFFER_SUCCESS) {
            printf(GREEN_CLR "DATAMGR: SBUFFER ERROR %d\n" OFF_CLR, res);
            break;
        }

        //add the sensor_data to the sensor_list
        datamgr_add_sensor_data(&new_data);
        
        pthread_mutex_lock(datamgr_lock);
        (*data_mgr)--;
        pthread_mutex_unlock(datamgr_lock);
    }
}

void datamgr_read_sensor_map(FILE* fp_sensor_map){
    if(fp_sensor_map == NULL){
        fprintf(stderr, "Error: NULL pointer fp_sensor_map\n");
        exit(ERROR_NULL_POINTER);
    }

    //add the room_id and sensor_id to the sensor_list
    while(!feof(fp_sensor_map)){
        //read each line in str unless empty/NULL 
        char str[8];
        if(fgets(str, 8, fp_sensor_map) == NULL) continue;

        //parse the room_id and sensor_id
        sensor_id_t s_id;
        room_id_t r_id;
        sscanf(str, "%hu %hu", &r_id, &s_id);

        // initialize the sensor
        sensor_t sens = {
            .room_id = r_id,  .sensor_id = s_id,
            .running_avg = 0.0,     .last_modified = 0,
            .buffer_position = 0,   .take_avg = false
        };
#ifdef DEBUG
        printf(GREEN_CLR "DATAMGR: NEW SENSOR ID: %d  ROOM ID: %d\n"OFF_CLR, sens.sensor_id, sens.room_id);
#endif
        //add the sensor_t to the sensor_list
        sensor_list = dpl_insert_at_index(sensor_list, &sens, 0, true);
    }
}

void datamgr_add_sensor_data(sensor_data_t* new_data){
    //find element in list where sensor_id = buffer_id and add the element
    bool added = false;


    for(int i = 0; i < dpl_size(sensor_list);i++){
        sensor_t* sns = dpl_get_element_at_index(sensor_list, i);

        // if the sensor_id is not the same, continue
        if(sns->sensor_id != new_data->id) continue;

        //add the new data point in the circular buffer
        sns->data_buffer[sns->buffer_position] = new_data->value;

        //update buffer pointer position
        sns->buffer_position++;

        //act as a circular buffer
        if(sns->buffer_position == RUN_AVG_LENGTH){
            sns->buffer_position = 0;
            sns->take_avg = true; //if the buffer is full, start taking the average
        }

        //update the timestamp
        sns->last_modified = new_data->ts;
                
        added = true;

        //if the buffer is not full we don't take the average
        if(sns->take_avg == false){
#ifdef DEBUG
            printf(GREEN_CLR "DATAMGR: ID: %u ROOM: %d  AVG: %f   TIME: %ld\n" OFF_CLR,
                sns->sensor_id, sns->room_id, sns->running_avg, sns->last_modified);
#endif
            continue;
        }

        //update the running average
        sensor_value_t avg = 0;

        // calculate sum of all elements in the buffer
        for(int i = 0; i < RUN_AVG_LENGTH; i++) avg = avg + sns->data_buffer[i];

        // calculate the average
        sns->running_avg = (avg / RUN_AVG_LENGTH);

        // log in case it is an extreme
        if(sns->running_avg > SET_MAX_TEMP){ 
          log_message(LOG_WARNING, "DataMgr/Thread-1", "SENSOR ID: %d TOO HOT! (AVG_TEMP = %f)\n", sns->sensor_id, sns->running_avg);
        }
        if(sns->running_avg < SET_MIN_TEMP){
          log_message(LOG_WARNING, "DataMgr/Thread-1", "SENSOR ID: %d TOO COOL! (AVG_TEMP = %f)\n", sns->sensor_id, sns->running_avg);
        } 
        
#ifdef DEBUG
        printf(GREEN_CLR "DATAMGR: ID: %u ROOM: %d  AVG: %f   TIME: %ld\n" OFF_CLR,
                sns->sensor_id, sns->room_id, sns->running_avg, sns->last_modified);
#endif
    }
    if(!added){
#ifdef DEBUG
        printf(GREEN_CLR "DATAMGR: DID NOT ADD DATA\n" OFF_CLR);
#endif
    }
}

void datamgr_free(){
    dpl_free(&sensor_list, true);
}


room_id_t datamgr_get_room_id(sensor_id_t sensor_id){
    for(int i = 0; i < dpl_size(sensor_list); i++){
        sensor_t* sensor = (sensor_t*) dpl_get_element_at_index(sensor_list, i);
        if(sensor->sensor_id == sensor_id) return sensor->room_id;
    }
    return 0;
}


sensor_value_t datamgr_get_avg(sensor_id_t sensor_id){
    for(int i = 0; i < dpl_size(sensor_list); i++){
        sensor_t* sensor = (sensor_t*) dpl_get_element_at_index(sensor_list, i);
        if(sensor->sensor_id == sensor_id) return sensor->running_avg;
    }
    return 0;
}


time_t datamgr_get_last_modified(sensor_id_t sensor_id){
    for(int i = 0; i < dpl_size(sensor_list); i++){
        sensor_t* sensor = (sensor_t*) dpl_get_element_at_index(sensor_list, i);
        if(sensor->sensor_id == sensor_id) return sensor->last_modified;
    }
    return 0;
}


int datamgr_get_total_sensors(){
    return dpl_size(sensor_list);
}

void sensor_free(void** element){
    free(*element);
    *element = NULL;
}

void* sensor_copy(void* element){
    sensor_t* sensor = (sensor_t*) element;
    sensor_t* copy = malloc(sizeof(sensor_t));
    copy->sensor_id = sensor->sensor_id;
    copy->room_id = sensor->room_id;
    copy->running_avg = sensor->running_avg;
    copy->last_modified = sensor->running_avg;
    return (void*) copy;
}

int sensor_compare(void* x, void* y){
    sensor_t* sensor_y = (sensor_t*) y;
    sensor_t* sensor_x = (sensor_t*) x;
    if(sensor_y->sensor_id == sensor_x->sensor_id) return 0;
    if(sensor_y->sensor_id < sensor_x->sensor_id) return 1;
    if(sensor_y->sensor_id > sensor_x->sensor_id) return -1;
    else return -1;
}

