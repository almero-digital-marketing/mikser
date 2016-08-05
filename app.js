#!/usr/bin/env node
var mikser = require('./index.js');
mikser({workingFolder: process.cwd()}).run();