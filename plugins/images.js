'use strict'

let path  = require('path');
let fs = require('fs-extra-promise');
let gm = require('gm');
let extend = require('node.extend');
let Promise = require('bluebird');
let minimatch = require('minimatch');
let _ = require('lodash');
let S = require('string');

module.exports = function (mikser, context) {
	let debug = mikser.debug('images');
	let predictDestination = mikser.manager.predictDestination;
	let findSource = mikser.manager.findSource;
	let isPathToFile = mikser.manager.isPathToFile;
	let config = {

		images: '**/*.{jpg,JPG,jpeg,JPEG,png,PNG,ico,bmp,BMP}',
		imageMagick: false,

		presets: {
			'default': { quality: 85 },
			'tiny': { width: 120, height: 90 },
			'small': { width: 320, height: 240 },
			'medium': { width: 640, height: 480 },
			'large': { width: 800, height: 600 },
			'x-large': { width: 1280, height: 960},
			'tiny-square': { width: 120, height: 120 },
			'small-square': { width: 240, height: 240 },
			'medium-square': { width: 320, height: 320 },
			'large-square': { width: 460, height: 460},
			'x-large-square': { width: 640, height: 640 },
			'tiny-wide': { width: 160, height: 90 },
			'small-wide': { width: 320, height:180},
			'medium-wide': { width: 640, height: 360 },
			'large-wide': { width: 960, height: 540},
			'x-large-wide': { width: 1366, height: 768 },
		},

		transforms: {
			resize: (info, width, height) => {
				width = width || info.preset.width;
				height = height || info.preset.height;
				if (!info.preset.name) {
					let ext = path.extname(info.destination);
					info.destination = info.destination.replace(ext, `-${width}x${height}${ext}`);
				}
				width = width == 'auto' ? null : width;
				height = height == 'auto' ? null : height;
				info.image
					.quality(info.preset.quality)
					.resize(width, height)
			},
			zoomcrop: (info, width, height) => {
				width = width || info.preset.width;
				height = height || info.preset.height;
				if (!info.preset.name) {
					let ext = path.extname(info.destination);
					info.destination = info.destination.replace(ext, `-${width}x${height}${ext}`);
				}
				width = width == 'auto' ? null : width;
				height = height == 'auto' ? null : height;
				info.image
					.quality(info.preset.quality)
					.gravity('Center')
					.resize(width, height, '^')
					.crop(width, height)
			},
			watermark: (info, watermark, alpha) => {
				let source = mikser.manager.findSource(watermark);
				info.command('composite')
					.gravity('Center')
					.in(source);
				if (alpha >= 0 && alpha <= 1) {
					alpha = `${alpha*100}%`;
					info.dissolve(alpha);
				}
			},
		},
	};

	config = _.defaultsDeep(mikser.options.images || {}, mikser.config.images || {}, config);

	function wrapTransforms(imageInfo) {
		for (let action in config.transforms) {
			imageInfo[action] = function() {
				imageInfo.preset = config.presets['default'];
				let args = [imageInfo].concat(Array.from(arguments));

				if (config.presets[args[1]]) {
					imageInfo.preset = extend(config.presets['default'], config.presets[args[1]]);
					imageInfo.preset.name = args[1];
					args.splice(1,1);
				}

				if (!imageInfo.keepDestination) {
					let newName;
					if (imageInfo.preset.name){
						newName = imageInfo.preset.name;
					}
					else {
						newName = action;
					}
					let ext = path.extname(imageInfo.destination);
					// update destination and url
					if (!S(imageInfo.destination).endsWith(newName + ext)) {
						imageInfo.destination = imageInfo.destination.replace(ext, '-' + newName + ext);
					}
				}

				// remove the preset from args
				let chain = config.transforms[action].apply(null, args) || imageInfo;
				delete imageInfo.preset;
				return chain;
			}
		}
	}

	function exposeTransforms (imageInfo) {
		let notForExpose = ['write', 'stream', 'toBuffer', 'addListener', 'addSrcFormatter', 'args', 'emit', 'on', 'format', 'identify', 'compare'];
		let commands = _.functionsIn(imageInfo.image);
		_.remove(commands, (command) => {
			return command.charAt(0) === '_' || _.includes(notForExpose, command);
		});

		for (let command of commands) {
			if (!config.transforms[command]) {
				config.transforms[command] = function (info) {
					if (command == 'command') {
						info.noProfile();
						pushTransforms(info);
					}
					info.image[command].apply(info.image, Array.from(arguments).slice(1));
				}
			}
		}
	}

	function isNotAllowedExtension (source) {
		return !minimatch(source, config.images);
	}

	function pushTransforms (imageInfo) {
		imageInfo.images = imageInfo.images || [];
		if (config.imageMagick) {
			let im = gm.subClass({ imageMagick: true});
			imageInfo.images.push(im());
		} else {
			imageInfo.images.push(gm());
		}

		exposeTransforms(imageInfo);
		wrapTransforms(imageInfo);
	}

	function transform(document, source, destination) {

		if(!source || typeof source !== 'string') {
			let err = new Error('Undefined source');
			err.origin = 'images';
			throw err;
		}

		if(!destination && !context) {
			let err = new Error('Undefined destination');
			err.origin = 'images';
			throw err;
		}

		let imageInfo = path.parse(source);
		Object.defineProperty(imageInfo, 'image', {
			get: function () {
				return imageInfo.images[imageInfo.images.length - 1];
			}
		});
		// if source extension is not valid
		if (isNotAllowedExtension(source)) {
			let err = new Error(`Source file extension ${imageInfo.ext} not recognised`);
			err.origin = 'images';
			throw err;
		}

		if (destination) {
			if (destination.indexOf(mikser.options.workingFolder) !== 0) {
				if (context) {
					imageInfo.destination = mikser.manager.resolveDestination(destination, document.destination);
				} else {
					imageInfo.destination = path.join(mikser.options.workingFolder, destination);
				}
			}
			else {
				imageInfo.destination = destination;
			}
			if (isPathToFile(destination)) {
				imageInfo.keepDestination = true;
			} else {
				imageInfo.destination = path.join(imageInfo.destination, imageInfo.base);
			}
		} else {
			imageInfo.destination = predictDestination(source);
			imageInfo.destination = mikser.manager.resolveDestination(imageInfo.destination, document.destination);
		}

		if (isNotAllowedExtension(imageInfo.destination)) {
			let ext = path.extname(imageInfo.destination).substring(1);
			let err = new Error(`Destination file extension ${ext} not recognised`);
			err.origin = 'images';
			throw err;
		}

		imageInfo.outFolder = path.dirname(imageInfo.destination);
		imageInfo.toString = () => mikser.manager.getUrl(imageInfo.destination);
		pushTransforms(imageInfo);

		return {
			process: () => {

				let sourceFilePath = findSource(source);
				// full path to file or undefined if file does not exist
				if (!sourceFilePath) {
					if (context) {
						return mikser.diagnostics.log(context, 'warning', `[images] File not found at: ${source}`);
					} else {
						return mikser.diagnostics.log('warning', `[images] File not found at: ${source}`);
					}
				}

				if ((sourceFilePath.indexOf(mikser.options.workingFolder) !== 0) && !destination) {
					let err = new Error(`Destination is missing for file ${imageInfo.base}`);
					err.origin = 'images';
					throw err;
				}

				let sourceStats = fs.statSync(sourceFilePath);
				// let destinationExists = fs.existsSync(imageInfo.destination);

				if (fs.existsSync(imageInfo.destination) && source != imageInfo.destination) {
					let destinationStats = fs.statSync(imageInfo.destination);
					if (destinationStats.mtime < sourceStats.mtime) {
						fs.unlinkSync(imageInfo.destination);
					} else {
						debug(imageInfo.destination.replace(mikser.options.workingFolder, ''), 'is newer than', sourceFilePath.replace(mikser.options.workingFolder, ''));
						return Promise.resolve();
					}
				}

				console.log('Image:', imageInfo.destination.replace(mikser.options.workingFolder, ''));
				fs.ensureDirSync(imageInfo.outFolder);

				let transforms = Promise.resolve();
				for (let i = 0; i < imageInfo.images.length; i++) {
					transforms = transforms.then(() => {
						if (i == 0) {
							imageInfo.images[i].source = sourceFilePath;
						} else {
							imageInfo.images[i].source = imageInfo.destination;
						}
						imageInfo.images[i].noProfile();
						let writeAsync = Promise.promisify(imageInfo.images[i].write, {context: imageInfo.images[i]});
						// debug(imageInfo.images[i], 'DEBUG INFO FOR IMAGE INSTANCE');
						debug(imageInfo.images[i]._subCommand, imageInfo.images[i]._in.join(' '), imageInfo.images[i]._out.join(' '));
						return writeAsync(imageInfo.destination);
					});
				}
				return transforms;

			},
			imageInfo: imageInfo
		}
	}

	if (context) {
		context.image = function(source, destination) {
			let imageTransform = transform(context.document, source, destination);
			context.process(() => {
				return imageTransform.process();
			});
			return imageTransform.imageInfo;
		}
	}

	let plugin = {
		transform: transform
	}

	return plugin;
}