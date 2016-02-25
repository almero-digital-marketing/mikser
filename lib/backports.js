module.exports = function(mikser) {
	mikser.manager['copy'] = mikser.manager.sync;

	return Promise.resolve(mikser);
}