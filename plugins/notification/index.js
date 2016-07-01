var cluster = require('cluster');

module.exports = function(mikser, context) {
	if (cluster.isMaster && mikser.config.browser) mikser.config.browser.push('notification');
}