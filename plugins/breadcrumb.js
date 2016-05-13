'use strict'

module.exports = function (mikser, context) {
	if (!context.entity.meta || !context.entity.meta.href) return;
	let breadcrumb = [context.entity.meta.href];
	let crumb = context.entity.meta.href;
	let i = crumb.lastIndexOf('/')
	while (i > 0) {
		crumb = crumb.substr(0,i);
		breadcrumb.unshift(crumb);
		i = crumb.lastIndexOf('/');
	}
	if (breadcrumb.length >= 2) {
		context.parent = breadcrumb[breadcrumb.length - 2];
	}
	context.data.breadcrumb = breadcrumb;
};