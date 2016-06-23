'use strict'

var $ = require('jquery');
var Mousetrap = require('mousetrap');

module.exports = function(mikser) {
	var locationOrigin = location.protocol + '//' + location.host;
	var messages = {
		watcher: 'Mikser watching ',
		debug: 'Mikser debug ',
	}

	$.get(locationOrigin + '/switch/watcher', function(data) {
		if (!data.status && !sessionStorage.getItem('mikser-switch-watcher')) {
			sessionStorage.setItem('mikser-switch-watcher', JSON.stringify({status: data.status}));
			mikser.plugins.notification.client(messages.watcher + (data.status ? 'enabled' : 'disabled') + 'from get');
		}
	});

	Mousetrap.bind(['ctrl+shift+w', 'command+shift+w'], function() {
		$.post(locationOrigin + '/switch/watcher', function(data){
			sessionStorage.setItem('mikser-switch-watcher', JSON.stringify({status: data.status}));
			mikser.plugins.notification.client(messages.watcher + (data.status ? 'enabled' : 'disabled'));
		});
		return false;
	});

	Mousetrap.bind(['ctrl+shift+d', 'command+shift+d'], function() {
		$.post(locationOrigin + '/switch/debug', function(data){
			mikser.plugins.notification.client(messages.debug + (data.status ? 'enabled' : 'disabled'));
		});
		return false;
	});

}