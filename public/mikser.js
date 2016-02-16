'use strict'

var Promise = require('bluebird');
var config = require('./config');
var livereload = require('./livereload');

var mikser = {
	laodPlugins: function() {
		return Promise.resolve();
	}
}

Promise.resolve(mikser)
	.then(config)
	.then(livereload)
	.then((mikser) => {
		return mikser.loadPlugins();
	});