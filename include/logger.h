#ifndef LOGGER_H
#define LOGGER_H

#include <stdio.h>

typedef enum {
    LOG_LEVEL_INFO,
    LOG_WARNING,
    LOG_ERROR,
    LOG_DEBUG
} log_level_t;

void logger_init(const char *filename);
void logger_close();
void log_message(log_level_t level, const char *module, const char *format, ...);

#endif