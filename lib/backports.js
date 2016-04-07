module.exports = function(mikser) {
	mikser.manager['copy'] = mikser.manager.sync;

	mikser.manager['findSource'] = mikser.utils.findSource;
	mikser.manager['isPathToFile'] = mikser.utils.isPathToFile;
	mikser.manager['isNewer'] = mikser.utils.isNewer;
	mikser.manager['resolveDestination'] = mikser.utils.resolveDestination;
	mikser.manager['predictDestination'] = mikser.utils.predictDestination;
	mikser.manager['getUrl'] = mikser.utils.getUrl;
	mikser.manager['getShare'] = mikser.utils.getShare;
	mikser.manager['extensions'] = mikser.utils.extensions;
	
	return Promise.resolve(mikser);
}