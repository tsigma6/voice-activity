
// Imports
const Discord = require('discord.js');
const Voice = require('@discordjs/voice');
const nodecg = require('./util/nodecg-api-context').get();

// NodeCG
const log = new nodecg.Logger(`${nodecg.bundleName}:discord`);
const voiceActivity = nodecg.Replicant('voiceActivity', {
	defaultValue: {
		members: new Map()
	}, persistent: false
});

// Discord API
const bot = new Discord.Client({intents: [
	Discord.GatewayIntentBits.MessageContent,
	Discord.GatewayIntentBits.Guilds,
	Discord.GatewayIntentBits.GuildMembers,
	Discord.GatewayIntentBits.GuildMessages,
	Discord.GatewayIntentBits.GuildVoiceStates,
]});
const botToken = nodecg.bundleConfig.discord.token;
const botServerID = nodecg.bundleConfig.discord.serverID;
const botCommandChannelID = nodecg.bundleConfig.discord.commandChannelID;
const botVoiceCommentaryChannelID = nodecg.bundleConfig.discord.voiceChannelID;

// Variables
let botIsReady = false;
let voiceChannelConnection;

// Connection
bot.on(Discord.Events.ClientReady, () => {
	log.info('Logged in as %s - %s\n', bot.user.username, bot.user.id);

	botIsReady = true;
});
bot.on(Discord.Events.Error, () => {
	log.error('The bot encountered a connection error!!');

	botIsReady = false;

	setTimeout(() => {
		bot.login(botToken);
	}, 10000);
});

bot.on(Discord.Events.ShardDisconnect, () => {
	log.error('The bot disconnected!!');

	botIsReady = false;

	setTimeout(() => {
		bot.login(botToken);
	}, 10000);
});

bot.login(botToken);

// Voice
bot.on(Discord.Events.VoiceStateUpdate, () => {

	UpdateCommentaryChannelMembers();

});

function UpdateCommentaryChannelMembers()
{
	if (!voiceActivity || !voiceActivity.value)
		return;

	voiceDisconnect = new Set(voiceActivity.value.members.keys())

	bot.guilds.resolve(botServerID).channels.resolve(botVoiceCommentaryChannelID).members.forEach((voiceMember, userID) => {

		if (voiceMember.user.bot)
			return;

		if (voiceActivity.value.members.has(userID)) {
			voiceDisconnect.remove(userID);
			return;
		}
		let userAvatar = voiceMember.displayAvatarURL();

		if (!userAvatar || userAvatar == null)
			userAvatar = voiceMember.defaultAvatarURL; // Default avatar
		voiceActivity.value.members[userID] = {userID: userID, name: voiceMember.displayName, avatar: userAvatar, isSpeaking: false};
		log.info(userID + ' joined the channel.')
	});

	// Have to rethink this.
	voiceDisconnect.forEach(userID => {
		voiceActivity.value.members.delete(userID);
		log.info(userID + ' left the channel.');
	});
}

// Commands
function commandChannel(message) {
	// ADMIN COMMANDS
	if (message.member.permissions.any(Discord.PermissionFlagsBits.ManageChannels)) {
		if (message.content.toLowerCase() === '!commands') {
			message.reply('ADMIN: [!bot join | !bot leave]');

		}

		else if (message.content.toLowerCase() === '!bot join') {

			if (voiceChannelConnection) {
				message.reply('I already entered the channel!');
				return;
			}

			channel = bot.guilds.resolve(botServerID).channels.resolve(botVoiceCommentaryChannelID);

			voiceChannelConnection = Voice.joinVoiceChannel({
				channelId: channel.id,
				guildId: channel.guild.id,
				adapterCreator: channel.guild.voiceAdapterCreator,
				selfDeaf: false,
				selfMute: true,
			});
			voiceChannelConnection.on(Voice.VoiceConnectionStatus.Disconnected, async () => {
				try {
					await Promise.race([
						Voice.entersState(voiceChannelConnection, Voice.VoiceConnectionStatus.Signalling, 5000),
						Voice.entersState(voiceChannelConnection, Voice.VoiceConnectionStatus.Connecting, 5000),
					]);
				} catch (error) {
					voiceChannelConnection.destroy();
					voiceChannelConnection = null;
					voiceActivity.value.members.clear();
				}
			});

			voiceChannelConnection.receiver.speaking.on('start', (userID) => {
				if (voiceActivity.value.members.has(userID))
					voiceActivity.value.members[userID].speaking = true;
					log.info(userID + ' has started speaking.')
			}).on('end', (userID) => {
				if (voiceActivity.value.members.has(userID))
					voiceActivity.value.members[userID].speaking = true;
					log.info(userID + ' has stopped speaking.')
			});

		}
		else if (message.content.toLowerCase() === '!bot leave') {

			if (!voiceChannelConnection) {
				message.reply('I\'m not in the podcast channel!');
				return;
			}
			voiceChannelConnection.destroy();
			voiceChannelConnection = null;
			voiceActivity.value.members.clear();
		}
	}
}

// Message Handling
bot.on(Discord.Events.MessageCreate, (message) => {
	if (message.channel.id == botCommandChannelID) {
		commandChannel(message);
		return;
	}
	if (message.content.toLowerCase() == '!status') {
		message.reply('Hey! I\'m online and ready to track the voice channel!');
	}
});
