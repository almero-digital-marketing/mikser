'use strict'

var yaml = require('js-yaml');
var fs = require('fs-extra-promise');
var cluster = require('cluster');
var Promise = require('bluebird');
var extend = require('node.extend');
var path = require('path');
var os = require('os');
var _ = require('lodash');

function init(mikser) {
	if (!mikser.config) {
		return new Promise((resolve, reject) => {
			let defaultConfig = {
				documentsFolder: path.join(mikser.options.workingFolder, 'documents'),
				layoutsFolder: path.join(mikser.options.workingFolder, 'layouts'),
				pluginsFolder: path.join(mikser.options.workingFolder, 'plugins'),
				filesFolder: path.join(mikser.options.workingFolder, 'files'),
				sharedFolder: path.join(mikser.options.workingFolder, 'shared'),
				runtimeFolder: path.join(mikser.options.workingFolder, 'runtime'),
				outputFolder: path.join(mikser.options.workingFolder, 'out'),
				workers: os.cpus().length,
				layouts: [],
				cooldown: 120,
				plugins: []
			};
			if (fs.existsSync('/dev/shm')) {
				defaultConfig.state = path.join('/dev/shm', 'state.json');
			} else {
				defaultConfig.state = path.join(defaultConfig.runtimeFolder, 'state.json');
			}

			let customConfig = {};
			let configFile = path.join(mikser.options.workingFolder, 'mikser.yml');
			if (fs.existsSync(configFile)) {
				customConfig = yaml.safeLoad(fs.readFileSync(configFile, 'utf8'));
			}

			let envConfig = {};
			if (mikser.options.environment) {
				let envConfigFile = path.join(mikser.options.workingFolder, mikser.options.environment + '.yml');
				if (fs.existsSync(envConfigFile)) {
					envConfig = yaml.safeLoad(fs.readFileSync(envConfigFile, 'utf8'));
				}
			}

			mikser.config = _.defaultsDeep(envConfig, customConfig, defaultConfig);
			mikser.config.plugins = _.union(['markdown', 'textile', 'swig', 'ect', 'swig', 'jade', 'ejs'], mikser.config.plugins);
			resolve(mikser);
		});
	} else {
		return Promise.resolve(mikser);
	}
}	
module.exports = init;