'use strict'

var yaml = require('js-yaml');
var fs = require('fs-extra-promise');
var cluster = require('cluster');
var Promise = require('bluebird');
var extend = require('node.extend');
var path = require('path');
var os = require('os');
var _ = require('lodash');

module.exports = function(mikser) {
	if (!mikser.config) {
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
		
		let configFile = path.join(mikser.options.workingFolder, 'mikser.yml');
		let files = fs.readdirSync(mikser.options.workingFolder);
		if (files.length && !fs.existsSync(configFile) && !mikser.options.environment) mikser.cli.help();

		if (fs.existsSync('/dev/shm')) {
			defaultConfig.state = path.join('/dev/shm', 'state.json');
		} else {
			defaultConfig.state = path.join(defaultConfig.runtimeFolder, 'state.json');
		}

		let customConfig = {};
		fs.ensureFileSync(configFile);
		customConfig = yaml.safeLoad(fs.readFileSync(configFile, 'utf8'));

		let envConfig = {};
		if (mikser.options.environment) {
			let envConfigFile = path.join(mikser.options.workingFolder, mikser.options.environment + '.yml');
			if (fs.existsSync(envConfigFile)) {
				envConfig = yaml.safeLoad(fs.readFileSync(envConfigFile, 'utf8'));
			}
		}

		mikser.config = _.defaultsDeep(envConfig, customConfig, defaultConfig);
		mikser.config.plugins = _.union(['markdown', 'textile', 'swig', 'ect', 'swig', 'jade', 'ejs', 'yaml', 'toml', 'json', 'cson', 'archieml'], mikser.config.plugins);
	}
	return Promise.resolve(mikser);
}