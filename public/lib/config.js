'use strict'

var Promise = require('bluebird');
var request = Promise.promisify(require('browser-request'));
Promise.promisifyAll(request);

module.exports = function(mikser) {
	return request('/mikser/config').then((response) => {
		mikser.config = JSON.parse(response.body);
		return Promise.resolve(mikser);
	});
}