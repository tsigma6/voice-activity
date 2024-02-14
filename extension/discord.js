// Imports
const Discord = require('discord.js');
const Voice = require('@discordjs/voice');
const nodecg = require('./util/nodecg-api-context').get();

// NodeCG
const log = new nodecg.Logger(`${nodecg.bundleName}:discord`);
const voiceActivity = nodecg.Replicant('voiceActivity', {
	defaultValue: {
		bots: {},
	},
	persistent: false,
});

class VoiceBot extends Discord.Client {
	voiceConnections = {};
	voiceActivity = {};

	constructor() {
		super({intents: [
			Discord.GatewayIntentBits.Guilds,
			Discord.GatewayIntentBits.GuildMembers,
			Discord.GatewayIntentBits.GuildVoiceStates,
		]});

		this.on(Discord.Events.ClientReady, () => {
			log.info('Logged in as %s - %s', this.user.username, this.user.id);

			voiceActivity.value.bots[this.user.id] = this.voiceActivity;
		});

		this.on(Discord.Events.VoiceStateUpdate, (oldState, newState) => {
			if(!(newState.guild.id in this.voiceActivity))
				return;

			if(newState.member.user === this.user) {
				if(newState.channel) {
					Object.assign(this.voiceActivity[newState.guild.id], {
						channelId: newState.channelId,
						channelName: newState.channel.name,
						guildName: newState.guild.name,
						guildId: newState.guild.id,
					});
					this.voiceActivity[newState.guild.id].members.clear();
					this.updateVoiceMembers(newState.channel);
					log.info(this.user.displayName + " joined " + newState.channel.name);
				}
				else {
					this.voiceActivity[newState.guild.id] = {};
					log.info(this.user.displayName + " left a channel or is being moved.");
				}
			} else {
				if(newState.member.user.bot)
					return;

				let va = this.voiceActivity[newState.guild.id];
				if(newState.channelId == va.channelId) {
					let memberAvatar = newState.member.displayAvatarURL();
					if(!memberAvatar)
						memberAvatar = member.defaultAvatarURL;

					this.voiceActivity[newState.guild.id].members.set(newState.member.user.id, {
						userId: newState.member.user.id,
						name: newState.member.displayName,
						avatar: memberAvatar,
						isSpeaking: false,
					});
					log.info(newState.member.displayName + " joined " + va.channelName);
				} else if(oldState.channelId == va.channelId && va.members.has(oldState.member.user.id)) {
					va.members.delete(oldState.member.user.id);
					log.info(oldState.member.displayName + " left " + va.channelName);
				}
			}
		});
	}

	updateVoiceMembers(channel) {
		channel.members.forEach((member) => {
			if(member.user.bot)
				return;

			let memberAvatar = member.displayAvatarURL();
			if(!memberAvatar)
				memberAvatar = member.defaultAvatarURL;

			this.voiceActivity[channel.guild.id].members.set(member.user.id, {
				userId: member.user.id,
				name: member.displayName,
				avatar: memberAvatar,
				isSpeaking: false,
			});
		});
	}

	joinChannel(channelId) {
		var channel = this.channels.resolve(channelId);
		if(!channel) {
			log.warn(channelId + ' was not found!');
			return false;
		}

		this.leaveChannel(channel.guild.id);

		var voices = new Map();
		this.voiceActivity[channel.guild.id] = {
			channelName: channel.name,
			channelId: channel.id,
			guildName: channel.guild.name,
			guildId: channel.guild.id,
			members: voices,
		};
		var connection = Voice.joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
			selfDeaf: false,
			selfMute: true,
		}).on(Voice.VoiceConnectionStatus.Disconnected, async () => {
			try {
				await Promise.race([
					Voice.entersState(connection, Voice.VoiceConnectionStatus.Signalling, 5000),
					Voice.entersState(connection, Voice.VoiceConnectionStatus.Connecting, 5000),
				]);
			} catch (error) {
				this.leaveChannel(connection.joinConfig.guildId);
			}
		});
		this.voiceConnections[channel.guild.id] = connection;

		connection.receiver.speaking.on('start', (userId) => {
			if(voices.has(userId)) {
				voices.get(userId).speaking = true;
			}
		}).on('end', (userId) => {
			if(voices.has(userId)) {
				voices.get(userId).speaking = false;
			}
		});
		return true;
	}

	leaveChannel(guildId) {
		this.voiceConnections[guildId]?.destroy();
		delete this.voiceConnections[guildId];
		delete voiceActivity.value.bots[this.user.id][guildId];
		delete this.voiceActivity[guildId];
	}

	refreshChannels() {
		let guilds = [];
		this.guilds.forEach((guild) => {
			let channels = [];
			guild.channels.forEach((channel) => {
				if(channel.isVoiceBased())
					channels.push({channelId: channel.id, channelName: channel.name});
			});
			guilds.push({
				guildId: guild.id,
				guildName: guild.name,
				voiceChannels: channels,
			});
		});
		return guilds;
	}
};

const bots = {};
nodecg.bundleConfig.botTokens.forEach(async (token) => {
	let bot = new VoiceBot();
	await bot.login(token);
	bots[bot.user.id] = bot;
});

module.exports = function(nodecg) {
	nodecg.listenFor('joinChannel', (value, ack) => {
		if(!value.botId || !value.channelId)
			ack(new Error("Passed object requires both botId and channelId."));

		bots[value.botId].joinChannel(value.channelId);
		if(ack && !ack.handled)
			ack(null, true);
	}).listenFor('leaveChannel', (value, ack) => {
		if(!value.botId || !value.guildId)
			ack(new Error("Passed object requires both botId and guildId"));

		bots[value.botId].leaveChannel(value.guildId);
		if(ack && !ack.handled)
			ack(null, true);
	}).listenFor('getChannels', (value, ack) => {
		let resp = [];
		bots.forEach((bot) => {
			resp.push({
				botId: bot.user.id,
				botName: bot.user.name,
				guilds: bot.refreshChannels(),
			});
		});
		ack(null, resp);
	});
}

