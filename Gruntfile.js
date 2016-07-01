module.exports = function(grunt) {

	grunt.initConfig({
		copy: {
			dev: {
				files: [{
					src: 'node_modules/nprogress/nprogress.css',
					dest: 'plugins/feedback/browser/vendor/nprogress/nprogress.css'
				}, {
					src: 'node_modules/snackbarjs/dist/snackbar.css',
					dest: 'plugins/notification/browser/vendor/snackbarjs/dist/snackbar.css'
				}, {
					src: 'node_modules/snackbarjs/themes-css/material.css',
					dest: 'plugins/notification/browser/vendor/snackbarjs/themes-css/material.css'
				}]
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.registerTask('default', ['copy']);
};