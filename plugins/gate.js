'use strict';
let _ = require('lodash');
let Promise = require('bluebird');
let fs = require('fs-extra-promise');
let path = require('path');
let cluster = require('cluster');
let shortid = require('shortid');
let MuxDemux = require('mux-demux/msgpack')
let reconnect = require('reconnect-net');
let net = require('net');
let S = require('string');

module.exports = function(mikser) {
	if (cluster.isWorker || mikser.config.gate === false) return;

	function client() {

	}

	mikser.on('mikser.server.ready', () => {
		reconnect((stream) => stream.pipe(client).pipe(socket)).connect({
			port: 9000,
			host: 'mikser.io'
		}).on('connect' () => {
			if (mikser.config.shared.length) {
				for (let share of mikser.config.shared) {
					mikser.diagnostics.log('info', 'Gate: http://' + mikser.options.gate + '.mikser.io' + S(share).ensureLeft('/').s);
				}
			}
			else {
				mikser.diagnostics.log('info', 'Gate: http://' + mikser.options.gate + '.mikser.io/');
			}
		});
	});

	if (mikser.config.gate && shortid.isValid(mikser.config.gate)) {
		mikser.options.gate = mikser.config.gate;
		return Promise.resolve();
	}
	let recent = path.join(mikser.config.runtimeFolder, 'recent', 'gate.json');
	return fs.existsAsync(recent).then((exists) => {
		if (exists) {
			return fs.readJsonAsync(recent, 'utf-8');
		} else {
			return {};
		}
	}).then((gateInfo) => {
		if (gateInfo.key) {
			mikser.options.gate = gateInfo.key;
			return Promise.resolve();
		}
		mikser.options.gate = shortid.generate();
		return fs.outputJsonAsync(gatePorts, {
			key: mikser.config.gate
		});
	});

}