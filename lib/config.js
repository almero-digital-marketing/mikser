'use strict'

var yaml = require('js-yaml');
var toml = require('toml');
var JSON5 = require('json5');
var cson = require('cson');

var fs = require('fs-extra-promise');
var cluster = require('cluster');
var Promise = require('bluebird');
var extend = require('node.extend');
var path = require('path');
var os = require('os');
var _ = require('lodash');

module.exports = function(mikser) {

	if(cluster.isMaster) {
		mikser.cli
			.option('-e, --env [name]', 'set custom configuration for specific environment')
			.init();
		mikser.options = _.defaults({ 
			environment: mikser.cli.env
		}, mikser.options);
	}


	function findConfig(name) {
		let configFile = path.join(mikser.options.workingFolder, name + '.json');
		if (fs.existsSync(configFile)) return configFile;
		configFile = path.join(mikser.options.workingFolder, name + '.json5');
		if (fs.existsSync(configFile)) return configFile;
		configFile = path.join(mikser.options.workingFolder, name + '.toml');
		if (fs.existsSync(configFile)) return configFile;
		configFile = path.join(mikser.options.workingFolder, name + '.cson');
		if (fs.existsSync(configFile)) return configFile;
		configFile = path.join(mikser.options.workingFolder, name + '.yaml');
		if (fs.existsSync(configFile)) return configFile;
		configFile = path.join(mikser.options.workingFolder, name + '.yml');
		return configFile;
	}

	function loadConfig(file) {
		if (!fs.existsSync(file)) return {};
		let content = fs.readFileSync(file, 'utf8');
		let extension = path.extname(file);
		if (extension == '.yml' || 
			extension == '.yaml') return yaml.safeLoad(content);
		if (extension == '.json' ||
			extension == '.json5') return JSON5.parse(content);
		if (extension == '.toml') return toml.parse(content);
		if (extension == '.cson') return cson.parse(content);
	}

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
		
		let configFile = findConfig('mikser');;
		let files = fs.readdirSync(mikser.options.workingFolder);
		if (files.length && !fs.existsSync(configFile) && !mikser.options.environment) mikser.cli.help();

		if (fs.existsSync('/dev/shm')) {
			defaultConfig.state = path.join('/dev/shm', 'state.json');
		} else {
			defaultConfig.state = path.join(defaultConfig.runtimeFolder, 'state.json');
		}

		let customConfig = {};
		fs.ensureFileSync(configFile);
		customConfig = loadConfig(configFile);
		mikser.options.configFile = configFile;

		let envConfig = {};
		if (mikser.options.environment) {
			let envConfigFile = findConfig(mikser.options.environment);
			envConfig = loadConfig(envConfigFile);
			mikser.options.environmentFile = envConfigFile;
		}

		mikser.config = _.defaultsDeep(envConfig, customConfig, defaultConfig);
		mikser.config.plugins = _.union(['markdown', 'textile', 'swig', 'ect', 'swig', 'jade', 'ejs', 'yaml', 'toml', 'json', 'cson', 'archieml'], mikser.config.plugins);
		console.log('Plugins:', mikser.config.plugins.join(','));
	}
	return Promise.resolve(mikser);
}