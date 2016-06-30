'use strict'
var $ = require('jquery');
require('snackbarjs');

module.exports = function (mikser) {
	mikser.loadResource('/mikser/browser/notification/style.css');

	return {
		client: function(message) {
			$.snackbar({
				content: message,
				style: 'toast',
				htmlAllowed: true,
				timeout: 3 * 1000,
			});
		},
		server: function(message) {
			$.snackbar({
				content: message,
				htmlAllowed: true,
				timeout: 10 * 1000,
			});
		}
	}

}