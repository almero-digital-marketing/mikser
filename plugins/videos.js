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
				videoCodec = videoCodec || info.preset.video;
				if (videoCodec) {
					info.video.videoCodec(videoCodec);					
				}
				audioCodec = audioCodec || info.preset.audio;
				if (audioCodec) {
					info.video.audioCodec(audioCodec);
				}
				if (info.preset.name == 'webm') {
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
		let commands = _.functions(videoInfo.video);
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

	context.video = function (source, destination) {
		if (!source) {
			let err = new Error('Undefined source');
			err.origin = 'videos';
			throw err;
		}

		let videoInfo = path.parse(source);

		if (destination) {
			if (destination.indexOf(mikser.options.workingFolder) != 0) {
				videoInfo.destination = mikser.manager.resolveDestination(destination, context.document.destination);
			}
			else {
				videoInfo.destination = destination;
			}
			if (mikser.manager.isPathToFile(videoInfo.destination)) {
				videoInfo.keepDestination = true;
			}
		} else {
			videoInfo.destination = mikser.manager.predictDestination(source);
			videoInfo.destination = mikser.manager.resolveDestination(videoInfo.destination, context.document.destination);
		}

		if (!mikser.manager.isPathToFile(videoInfo.destination)) {
			videoInfo.destination = path.join(videoInfo.destination, videoInfo.base);
		}

		videoInfo.toString = () => mikser.manager.getUrl(videoInfo.destination);
		videoInfo.outFolder = path.dirname(videoInfo.destination);
		videoInfo.video = ffmpeg();

		exposeTransforms(videoInfo);
		wrapTransforms(videoInfo);

		context.pending = context.pending.then(() => {

			videoInfo.source = mikser.manager.findSource(source);
			if (!videoInfo.source) {
				return mikser.diagnostics.log(context, 'warning', `[videos] File not found at: ${source}`);
			}

			if ((videoInfo.source.indexOf(mikser.options.workingFolder) !== 0) && !destination) {
				let err = new Error(`Destination is missing for file ${videoInfo.base}`);
				err.origin = 'videos';
				throw err;
			}
			videoInfo.mtime = fs.statSync(videoInfo.source).mtime;
			fs.ensureDirSync(videoInfo.outFolder);

			if (fs.existsSync(videoInfo.destination)) {
				let destinationMtime = fs.statSync(videoInfo.destination).mtime;
				if (destinationMtime < videoInfo.mtime) {
					fs.unlinkSync(videoInfo.destination);
				} else {
					return Promise.resolve();
				}
			}

			videoInfo.video.input(videoInfo.source);
			return outputAndSaveAsync(videoInfo);
		});
		return videoInfo;
	}
}