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
			.option('--documents [path]', 'set documents folder')
			.option('--layouts [path]', 'set layouts folder')
			.option('--plugins [path]', 'set plugins folder')
			.option('--files [path]', 'set files folder')
			.option('--shared [path]', 'set shared folder')
			.option('--views [path]', 'set views folder')
			.option('--build [path]', 'set build folder')
			.option('--runtime [path]', 'set runtime folder')
			.option('--output [path]', 'set output folder')
			.init();
		mikser.options = _.defaults({ 
			environment: mikser.cli.env,
			documents: mikser.cli.documents,
			layouts: mikser.cli.layouts,
			plugins: mikser.cli.plugins,
			files: mikser.cli.files,
			shared: mikser.cli.shared,
			views: mikser.cli.views,
			build: mikser.cli.build,
			runtime: mikser.cli.runtime,
			output: mikser.cli.output,

		}, mikser.options);
	}
	var debug = mikser.debug('config');

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
		if (fs.existsSync(configFile)) return configFile;

		let presetFile = path.join(__dirname, '../presets', name + '.yml');
		if (fs.existsSync(presetFile)) return presetFile;

		return configFile;
	}

	function loadConfig(file) {
		if (!fs.existsSync(file)) return {};
		debug(file);
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
			documentsFolder: path.join(mikser.options.workingFolder, mikser.options.documents || 'documents'),
			layoutsFolder: path.join(mikser.options.workingFolder, mikser.options.layouts || 'layouts'),
			pluginsFolder: path.join(mikser.options.workingFolder, mikser.options.plugins || 'plugins'),
			browserFolder: path.join(mikser.options.workingFolder, mikser.options.browser || 'browser'),
			filesFolder: path.join(mikser.options.workingFolder, mikser.options.files || 'files'),
			sharedFolder: path.join(mikser.options.workingFolder, mikser.options.shared || 'shared'),
			viewsFolder: path.join(mikser.options.workingFolder, mikser.options.views || 'views'),
			buildFolder: path.join(mikser.options.workingFolder, mikser.options.build || 'build'),
			runtimeFolder: path.join(mikser.options.workingFolder, mikser.options.runtime || 'runtime'),
			outputFolder: path.join(mikser.options.workingFolder, mikser.options.out || 'out'),
			workers: Math.max(1, os.cpus().length - 1),
			layouts: [],
			cooldown: 120,
			plugins: [],
			browser: [],
			cleanUrlDestination: 'index.html'
		};
		defaultConfig.runtimeFilesFolder = path.join(defaultConfig.runtimeFilesFolder, 'files')
		
		let configFile = findConfig('mikser');
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
			console.log('Environment:', envConfigFile)
			envConfig = loadConfig(envConfigFile);
			mikser.options.environmentFile = envConfigFile;
		}

		mikser.config = _.defaultsDeep(envConfig, customConfig, defaultConfig);
		if (!mikser.config.blank && !mikser.options.base) {
			mikser.config.plugins = _.union([
				'markdown', 
				'textile', 
				'swig', 
				'ect', 
				'twig', 
				'pug', 
				'ejs', 
				'yaml', 
				'toml', 
				'json', 
				'cson', 
				'csv',
				'archieml',
				'nunjucks',
				'browser',
				'livereload',
				'feedback',
				'switch',
				'gate'], mikser.config.plugins);
			if (mikser.config.browser !== false) {
				mikser.config.browser = _.union([
					'notification'], mikser.config.browser);				
			}
		}
		if (mikser.config.plugins.length)
			console.log('Plugins:', mikser.config.plugins.join(','));
	}

	let packageJSON = path.join(mikser.options.workingFolder, 'package.json');
	if (fs.existsSync(packageJSON)) {
		mikser.config.package = fs.readJsonSync(packageJSON);
	}

	return Promise.resolve(mikser);
}