'use strict'

var Promise = require('bluebird');
var mikser = require('./lib/mikser');
var config = require('./lib/config');
var ui = require('./lib/ui');
var livereload = require('./lib/livereload');

mikser()
	.then(config)
	.then(livereload)
	.then(ui)
	.then((mikser) => {
		window.addEventListener('scroll', (event) => {
			console.log(event);
		}, false);
	});

