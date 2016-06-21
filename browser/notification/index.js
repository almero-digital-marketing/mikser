'use strict'
var $ = require('jquery');
require('snackbarjs');
require('./style.css');

module.exports = function (mikser) {

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