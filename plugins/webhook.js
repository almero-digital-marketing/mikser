'use strict'

var Promise = require('bluebird');
var webhookHandler = require('github-webhook-handler');
var exec = Promise.promisify(require('child_process').exec);
var _ = require('lodash');

module.exports = function (mikser) {
	mikser.config = _.defaultsDeep(mikser.config, {
		webhook: { path: '/webhook', secret: '', command:''	}
	});

	mikser.on('mikser.server.listen', (app) => {
		var webhook = webhookHandler({ path: mikser.config.webhook.path, secret: mikser.config.webhook.secret });
		console.log('Webhook: http://localhost:' + mikser.config.serverPort + mikser.config.webhook.path );
		webhook.on('push', (event) => {
			exec(mikser.config.webhook.command).then((stdout, stderr) => {
				console.log(stdout);
				if (stderr) {
					console.log(stderr);
				}
			}).then(() => {
				if (!mikser.options.watch) {
					mikser.compilator.compile()
						.then(mikser.manager.copy)
						.then(mikser.manager.glob)
						.then(mikser.scheduler.process);							
				}
			});
		});
		app.use(webhook);
	});
};