'use strict'

let path = require('path');
let ffmpeg = require('fluent-ffmpeg');
let fs = require('fs-extra-promise');
let Promise = require('bluebird');
let extend = require('node.extend');
let _ = require('lodash');
let S = require('string');

module.exports = function (mikser, context) {
	let debug = mikser.debug('videos');

	let config = {
		presets: {
			'360p': { width: 640, height: 360 },
			'480p': { width: 853, height: 480 },
			'720p': { width: 1280, height: 720 },
			'1080p': { width: 1920, height: 1080 },
			'mp4': { video: 'libx264', audio: 'aac' },
			'webm': { video: 'libvpx', videoBitrate: 1000 }
		},

		transforms: {
			convert: (info, videoCodec, audioCodec) => {
				if (!info.keepDestination && info.preset) {
					info.destination = info.destination.replace(path.extname(info.destination), '.' + info.preset.name);
				}

				if (info.preset && !videoCodec) {
					videoCodec = info.preset.video;
				}
				if (videoCodec) {
					info.video.videoCodec(videoCodec);
				}

				if (info.preset && !audioCodec) {
					audioCodec = info.preset.audio;
				}
				if (audioCodec) {
					info.video.audioCodec(audioCodec);
				}

				if (info.preset && info.preset.name == 'webm') {
					info.video.videoBitrate(info.preset.videoBitrate);
				}
			},
			resize: (info, width, height) => {
				width = width || (info.preset ? info.preset.width : '?');
				height = height || (info.preset ? info.preset.height : '?');
				if (!info.preset)  {
					let ext = path.extname(info.destination);
					let stringArgs = S(`${width}x${height}`).replaceAll('?', '').s;
					info.destination = info.destination.replace(ext, `-${stringArgs}${ext}`);
				}

				info.video.size(`${width}x${height}`);
			},
			screenshot: (info, timestamp) => {
				info.destination = info.destination.replace(path.extname(info.destination), '.jpg');
				let options = {
					folder: info.outFolder,
					filename: path.basename(info.destination),
					timestamps: [timestamp || '50%'],
				}
				info.takeScreenshot = () => {
					debug('Screenshot at', options.timestamps[0]);
					info.video.screenshots(options);
				}
			},
		},
	}

	config = _.defaultsDeep(mikser.options.videos || {}, mikser.config.videos || {}, config);

	function wrapTransforms(videoInfo) {
		for (let action in config.transforms) {
			videoInfo[action] = function() {
				let args = [videoInfo].concat(Array.from(arguments));
				videoInfo.preset = config.presets[args[1]];
				if (videoInfo.preset) { 
					videoInfo.preset.name = args[1];
					args.splice(1,1);
				}

				if (!videoInfo.keepDestination) {
					let newName;
					if (videoInfo.preset && !_.includes(['webm', 'mp4'], videoInfo.preset.name)){
						newName = videoInfo.preset.name;
					}
					else {
						newName = action;
					}
					let ext = path.extname(videoInfo.destination);
					// update destination and url
					videoInfo.destination = videoInfo.destination.replace(ext, '-' + newName + ext);
				}
				config.transforms[action].apply(null, args);
				// remove the preset from args
				delete videoInfo.preset;
				return videoInfo;
			}
		}
	}

	function exposeTransforms (videoInfo) {
		let notForExpose = ['screenshots', 'save', 'run', 'saveToFile', 'pipe', 'exec', 'execute', 'stream', 'writeToStream', 'ffprobe', 'input', 'addInput', 'output', 'addOutput', 'addListener', 'addOutput', 'emit', 'on', 'getAvailableFormats', 'getAvailableCodecs', 'getAvailableEncoders', 'getAvailableFilters'];
		let commands = _.functionsIn(videoInfo.video);
		_.remove(commands, (command) => {
			return command.charAt(0) === '_' || _.includes(notForExpose, command);
		});

		for (let command of commands) {
			if (!config.transforms[command]) {
				config.transforms[command] = function (info) {
					info.video[command].apply(info.video, Array.from(arguments).slice(1));
				}
			}
		}
	}

	function outputAndSave(videoInfo, next) {
		let padding = 0;
		let progress = 0;
		videoInfo.video.on('error', (err) => {
			if (fs.existsSync(videoInfo.destination)) {
				fs.unlinkSync(videoInfo.destination);
			}
			mikser.diagnostics.log(context, 'error', '[videos] ' + err.message);
			next(err);
		}).on('progress', (data) => {
			if (!videoInfo.takeScreenshot) {
				let outputInfo = 'Video: ' + videoInfo.destination.replace(mikser.options.workingFolder, '') + ' ' + new Array(++progress%4+1).join('.') + '   ';
				if (data.percent) {
					let percent = Math.round(data.percent);
					outputInfo = 'Video: ' + videoInfo.destination.replace(mikser.options.workingFolder, '') + ' ' + percent + '%';
				}
				padding = Math.max(outputInfo.length, padding);
				process.stdout.write(S(outputInfo).padRight(padding) + '\x1b[0G');
			}
		}).on('end', () => {
			process.stdout.write(S(' ').padRight(padding) + '\x1b[0G');
			next();
		});
		if (videoInfo.takeScreenshot) {videoInfo.takeScreenshot() }
		else {
			videoInfo.video.save(videoInfo.destination); 
		}
	}
	let outputAndSaveAsync = Promise.promisify(outputAndSave);

	function transform(source, destination) {
		
		if (!source) {
			let err = new Error('Undefined source');
			err.origin = 'videos';
			throw err;
		}

		if (!destination && !context) {
			let err = new Error('Undefined destination');
			err.origin = 'videos';
			throw err;
		}

		let videoInfo = path.parse(source);

		if (destination) {
			if (destination.indexOf(mikser.options.workingFolder) !== 0) {
				if (context) {
					videoInfo.destination = mikser.utils.resolveDestination(destination, context.entity.destination);
				} else {
					videoInfo.destination = path.join(mikser.options.workingFolder, destination);
				}
			}
			else {
				videoInfo.destination = destination;
			}
			if (mikser.utils.isPathToFile(videoInfo.destination)) {
				videoInfo.keepDestination = true;
			}
		} else {
			videoInfo.destination = mikser.utils.predictDestination(source);
			videoInfo.destination = mikser.utils.resolveDestination(videoInfo.destination, context.entity.destination);
		}

		if (!mikser.utils.isPathToFile(videoInfo.destination)) {
			videoInfo.destination = path.join(videoInfo.destination, videoInfo.base);
		}

		videoInfo.toString = () => mikser.utils.getUrl(videoInfo.destination);
		videoInfo.outFolder = path.dirname(videoInfo.destination);
		videoInfo.video = ffmpeg();
		videoInfo.on = () => {
			videoInfo.overwrite = true;
			return videoInfo;
		}
		videoInfo.off = () => {
			videoInfo.overwrite = false;
			return videoInfo;
		}
		videoInfo.skip = (state) => {
			videoInfo.skipped = state;
			if (state) videoInfo.destination = source;
			return videoInfo
		}

		exposeTransforms(videoInfo);
		wrapTransforms(videoInfo);

		return {
			process: () => {
				if (videoInfo.skipped) return Promise.resolve();
				let sourceFilePath = mikser.utils.findSource(source);
				if (!sourceFilePath) {
					return mikser.diagnostics.log(this, 'warning', `[videos] File not found at: ${source}`);
				}

				if ((sourceFilePath.indexOf(mikser.options.workingFolder) !== 0) && !videoInfo.destination) {
					let err = new Error(`Destination is missing for file ${videoInfo.base}`);
					err.origin = 'videos';
					throw err;
				}

				return fs.existsAsync(videoInfo.destination).then((exist) => {
					let overwrite = Promise.resolve(true);
					if (exist && source != videoInfo.destination) {
						if (videoInfo.overwrite) {
							overwrite = fs.unlinkAsync(videoInfo.destination).return(true);
						} else if (videoInfo.overwrite === false) {
							overwrite = Promise.resolve(videoInfo.overwrite)
						} else {
							overwrite = Promise.join(fs.statAsync(sourceFilePath), fs.statAsync(videoInfo.destination), (sourceStats, destinationStats) => {
								if (destinationStats.mtime < sourceStats.mtime) {
									return fs.unlinkAsync(videoInfo.destination).return(true);
								} else {
									debug(videoInfo.destination.replace(mikser.options.workingFolder, ''), 'is newer than', sourceFilePath.replace(mikser.options.workingFolder, ''));
									return Promise.resolve(false);
								}
							});
						}
					}

					return overwrite.then((newer) => {
						if (!newer) return Promise.resolve();
						fs.ensureDirSync(videoInfo.outFolder);
						videoInfo.video.input(sourceFilePath);
						return outputAndSaveAsync(videoInfo);
					});
				});
			},
			videoInfo: videoInfo
		}
	}

	if (context) {
		context.video = function(source, destination) {
			let videoTransform = transform(source, destination);
			context.process(videoTransform.process);
			return videoTransform.videoInfo;
		}
	}

	let plugin = {
		transform: transform
	}

	return plugin;
}