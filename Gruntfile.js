module.exports = function(grunt) {

	grunt.initConfig({
		copy: {
			dev: {
				files: [{
					src: 'node_modules/nprogress/nprogress.css',
					dest: 'browser/feedback/vendor/nprogress/nprogress.css'
				}, {
					src: 'node_modules/snackbarjs/dist/snackbar.css',
					dest: 'browser/notification/vendor/snackbarjs/dist/snackbar.css'
				}, {
					src: 'node_modules/snackbarjs/themes-css/material.css',
					dest: 'browser/notification/vendor/snackbarjs/themes-css/material.css'
				}]
			}
		}
	});

	grunt.loadNpmTasks('grunt-contrib-copy');
	grunt.registerTask('default', ['copy']);
};