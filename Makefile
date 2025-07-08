# Makefile for Sensor Gateway and Sensor Node

# Compiler and flags
CC = gcc
CFLAGS = -Wall -Werror -std=c11 -fdiagnostics-color=auto -Iinclude -Ilib  -DSET_MIN_TEMP=25 -DSET_MAX_TEMP=35 -DTIMEOUT=3600
LDFLAGS = -Llib -ltcpsock -lpthread -lsqlite3

# Directories
SRC_DIR = src
NODE_DIR = node
LIB_DIR = lib
INCLUDE_DIR = include
BUILD_DIR = build
BIN_DIR = bin

# Output files
GATEWAY_EXE = $(BIN_DIR)/sensor_gateway
NODE_EXE = $(BIN_DIR)/sensor_node

# Source files
SRC_FILES = $(wildcard $(SRC_DIR)/*.c)
NODE_FILES = $(wildcard $(NODE_DIR)/*.c)
LIB_FILES = $(wildcard $(LIB_DIR)/*.c)

# Object files
GATEWAY_OBJS = $(patsubst %.c,$(BUILD_DIR)/%.o,$(notdir $(SRC_FILES)) $(notdir $(LIB_FILES)))
NODE_OBJS = $(patsubst %.c,$(BUILD_DIR)/%.o,$(notdir $(NODE_FILES)) $(notdir $(LIB_FILES)))

# Rules
.PHONY: all clean run node1 node2 node3 debug

all: setup $(GATEWAY_EXE) $(NODE_EXE)

setup:
	@mkdir -p $(BUILD_DIR) $(BIN_DIR)

# Compile gateway
$(GATEWAY_EXE): $(GATEWAY_OBJS)
	$(CC) $^ -o $@ $(LDFLAGS)

# Compile node
$(NODE_EXE): $(NODE_OBJS)
	$(CC) $^ -o $@ $(LDFLAGS)

# Build object files
$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/%.o: $(NODE_DIR)/%.c
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/%.o: $(LIB_DIR)/%.c
	$(CC) $(CFLAGS) -c $< -o $@

# Convenience targets
run: $(GATEWAY_EXE)
	./bin/sensor_gateway 12345

node1: $(NODE_EXE)
	./$(NODE_EXE) 15 2 127.0.0.1 12345

node2: $(NODE_EXE)
	./$(NODE_EXE) 21 2 127.0.0.1 12345

node3: $(NODE_EXE)
	./$(NODE_EXE) 37 2 127.0.0.1 12345

debug: $(GATEWAY_EXE)
	valgrind --leak-check=full --track-origins=yes ./$(GATEWAY_EXE) 12345

clean:
	rm -rf $(BUILD_DIR) $(BIN_DIR)