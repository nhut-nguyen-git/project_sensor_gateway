#include "logger.h"
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <pthread.h>

/// Static file pointer to hold the log file reference
static FILE *log_file = NULL;

/// Mutex for thread-safe logging
static pthread_mutex_t log_mutex = PTHREAD_MUTEX_INITIALIZER;

/// String representations for each log level
static const char *log_level_str[] = {
    "INFO",
    "WARN",
    "ERROR",
    "DEBUG"
};

/**
 * @brief Initialize the logger with a given log file name.
 *        Opens the file in append mode.
 *
 * @param filename The name of the file to write logs to.
 */
void logger_init(const char *filename) {
    log_file = fopen(filename, "a");
    if (!log_file) {
        perror("Failed to open log file");
        exit(EXIT_FAILURE);
    }
}

/**
 * @brief Close the log file if open.
 */
void logger_close() {
    if (log_file) {
        fclose(log_file);
        log_file = NULL;
    }
}

/**
 * @brief Write a formatted log message with timestamp, level, module.
 *
 * Format: [YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [MODULE] MESSAGE
 *
 * @param level The log level (INFO, WARN, ERROR, DEBUG).
 * @param module A string identifying the module or thread (e.g., ConnMgr/Thread-1).
 * @param format The printf-style message format string.
 * @param ... Additional arguments for the format string.
 */
void log_message(log_level_t level, const char *module, const char *format, ...) {
    if (!log_file || !module) return;

    // Get current time with millisecond precision
    struct timeval tv;
    gettimeofday(&tv, NULL);
    struct tm *tm_info = localtime(&tv.tv_sec);

    char timestamp[32];
    snprintf(timestamp, sizeof(timestamp),
             "%04d-%02d-%02d %02d:%02d:%02d.%03ld",
             tm_info->tm_year + 1900,
             tm_info->tm_mon + 1,
             tm_info->tm_mday,
             tm_info->tm_hour,
             tm_info->tm_min,
             tm_info->tm_sec,
             tv.tv_usec / 1000);

    // Write log message in a thread-safe manner
    pthread_mutex_lock(&log_mutex);

    fprintf(log_file, "[%s] [%s] [%s] ", timestamp, log_level_str[level], module);

    va_list args;
    va_start(args, format);
    vfprintf(log_file, format, args);
    va_end(args);

    fprintf(log_file, "\n");
    fflush(log_file);  // Ensure it's written to disk immediately

    pthread_mutex_unlock(&log_mutex);
}