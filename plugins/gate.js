'use strict';
let _ = require('lodash');
let Promise = require('bluebird');
let fs = require('fs-extra-promise');
let path = require('path');
let cluster = require('cluster');
let shortid = require('shortid');
let MuxDemux = require('mux-demux/msgpack')
let reconnect = require('reconnect-net');
let S = require('string');
let net = require('net');
let base32 = require('base32')

module.exports = function(mikser) {
	if (cluster.isWorker || mikser.config.gate === false) return;
	let debug = mikser.debug('gate');

	mikser.on('mikser.server.ready', () => {
		reconnect((connection) => {
			let mx = MuxDemux((stream) => {
				if (stream.meta.tunnel) {
					stream.pipe(net.connect({port: mikser.config.serverPort})).pipe(stream).on('error', debug);					
				}
			});
			connection.pipe(mx).pipe(connection);
			mx.createStream({
				gate: mikser.options.gate
			}).end();
		}).connect({
			port: 9090,
			host: 'mikser.io'
		}).on('error', debug);

		if (mikser.config.shared.length) {
			for (let share of mikser.config.shared) {
				mikser.diagnostics.log('info', 'Gate: http://' + 'm' + base32.encode(mikser.options.gate) + '.mikser.io' + S(share).ensureLeft('/').s);
			}
		}
		else {
			mikser.diagnostics.log('info', 'Gate: http://' + 'm' + base32.encode(mikser.options.gate) + '.mikser.io/');
		}
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
		if (gateInfo.gate) {
			mikser.options.gate = gateInfo.gate;
			return Promise.resolve();
		}
		mikser.options.gate = shortid.generate();
		return fs.outputJsonAsync(recent, {
			gate: mikser.options.gate
		});
	});

}