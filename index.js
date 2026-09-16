const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  AuditLogEvent,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType
} = require("discord.js");

const config = require("./config.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.GuildMember]
});

const actionTracker = new Map();
const raidTracker = new Map();
const whitelist = new Map();
const logChannels = new Map();

function isWhitelisted(guildId, userId) {
  if (userId === client.user?.id) return true;
  return whitelist.get(guildId)?.has(userId) ?? false;
}

function trackAction(guildId, userId, action, amount, time) {
  const key = `${guildId}:${userId}:${action}`;
  const now = Date.now();

  const actions = (actionTracker.get(key) || [])
    .filter(timestamp => now - timestamp < time);

  actions.push(now);
  actionTracker.set(key, actions);

  return actions.length >= amount;
}

function trackRaid(guildId) {
  const now = Date.now();

  const joins = (raidTracker.get(guildId) || [])
    .filter(timestamp => now - timestamp < config.raid.time);

  joins.push(now);
  raidTracker.set(guildId, joins);

  return joins.length >= config.raid.amount;
}

async function sendLog(guild, title, description, color = 0xff0000) {
  const channelId = logChannels.get(guild.id);
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: "NexGuard Security" });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function getExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type,
      limit: 5
    });

    const entry = logs.entries.find(entry =>
      (!targetId || entry.target?.id === targetId) &&
      Date.now() - entry.createdTimestamp < 10000
    );

    return entry?.executor || null;
  } catch {
    return null;
  }
}

async function punish(guild, userId, reason) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  if (!member.kickable) {
    await sendLog(
      guild,
      "⚠️ NexGuard kon niet ingrijpen",
      `**${member.user.tag}** kon niet worden verwijderd.\nControleer de rolvolgorde van NexGuard.`,
      0xffa500
    );
    return;
  }

  await member.kick(reason).catch(() => {});

  await sendLog(
    guild,
    "🛡️ NexGuard heeft ingegrepen",
    `**Gebruiker:** ${member.user.tag}\n**Actie:** Kick\n**Reden:** ${reason}`,
    0x00ff66
  );
}

client.once("ready", async () => {
  console.log("=================================");
  console.log("        NEXGUARD ONLINE");
  console.log("=================================");
  console.log(`Bot: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "🛡️ Server Security",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });

  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Stel NexGuard in en maak security logs."),

    new SlashCommandBuilder()
      .setName("security")
      .setDescription("Bekijk de NexGuard beveiligingsstatus."),

    new SlashCommandBuilder()
      .setName("whitelist")
      .setDescription("Voeg een gebruiker toe aan de whitelist.")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("De gebruiker")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("unwhitelist")
      .setDescription("Verwijder een gebruiker van de whitelist.")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("De gebruiker")
          .setRequired(true)
      )
  ].map(command => command.toJSON());

  const rest = new REST({
    version: "10"
  }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    {
      body: commands
    }
  );

  console.log("Slash commands geregistreerd.");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return interaction.reply({
      content: "❌ Je hebt Administrator nodig.",
      ephemeral: true
    });
  }

  const guild = interaction.guild;

  if (interaction.commandName === "setup") {
    let channel = guild.channels.cache.find(
      channel =>
        channel.name === "nexguard-logs" &&
        channel.isTextBased()
    );

    if (!channel) {
      channel = await guild.channels.create({
        name: "nexguard-logs",
        reason: "NexGuard security logs"
      });
    }

    logChannels.set(guild.id, channel.id);

    await interaction.reply({
      content:
        `✅ **NexGuard is ingesteld!**\n\n` +
        `📋 Logs: ${channel}\n` +
        `🛡️ Anti-Nuke: Aan\n` +
        `🚨 Anti-Raid: Aan\n` +
        `🤖 Anti-Bot: Aan`,
      ephemeral: true
    });

    return sendLog(
      guild,
      "🛡️ NexGuard geactiveerd",
      `Ingesteld door **${interaction.user.tag}**.`,
      0x00ff66
    );
  }

  if (interaction.commandName === "security") {
    return interaction.reply({
      content:
        "🛡️ **NexGuard Security**\n\n" +
        "🟢 Anti-Nuke: Aan\n" +
        "🟢 Anti-Raid: Aan\n" +
        "🟢 Anti-Mass Ban/Kick: Aan\n" +
        "🟢 Anti-Channel Delete: Aan\n" +
        "🟢 Anti-Role Delete/Create: Aan\n" +
        "🟢 Anti-Bot: Aan",
      ephemeral: true
    });
  }

  if (interaction.commandName === "whitelist") {
    const user = interaction.options.getUser("user");

    if (!whitelist.has(guild.id)) {
      whitelist.set(guild.id, new Set());
    }

    whitelist.get(guild.id).add(user.id);

    return interaction.reply({
      content: `✅ **${user.tag}** staat nu op de whitelist.`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "unwhitelist") {
    const user = interaction.options.getUser("user");

    whitelist.get(guild.id)?.delete(user.id);

    return interaction.reply({
      content: `✅ **${user.tag}** is van de whitelist verwijderd.`,
      ephemeral: true
    });
  }
});

client.on("guildMemberAdd", async member => {
  if (config.antiBot && member.user.bot) {
    await sendLog(
      member.guild,
      "🤖 Nieuwe bot gedetecteerd",
      `**${member.user.tag}** is automatisch gecontroleerd.`,
      0xffa500
    );

    if (member.kickable) {
      await member.kick("NexGuard Anti-Bot").catch(() => {});
    }

    return;
  }

  if (config.antiRaid && trackRaid(member.guild.id)) {
    await sendLog(
      member.guild,
      "🚨 MOGELIJKE RAID GEDETECTEERD",
      "Er zijn in korte tijd veel leden gejoined.",
      0xff0000
    );
  }
});

client.on("guildBanAdd", async ban => {
  const guild = ban.guild;

  const executor = await getExecutor(
    guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id
  );

  if (!executor) return;
  if (isWhitelisted(guild.id, executor.id)) return;

  if (
    trackAction(
      guild.id,
      executor.id,
      "ban",
      config.limits.ban.amount,
      config.limits.ban.time
    )
  ) {
    await sendLog(
      guild,
      "🚨 ANTI-NUKE ACTIE",
      `**${executor.tag}** heeft te veel bans uitgevoerd.`,
      0xff0000
    );

    await punish(
      guild,
      executor.id,
      "NexGuard Anti-Mass-Ban"
    );
  }
});

client.on("guildMemberRemove", async member => {
  const guild = member.guild;

  const executor = await getExecutor(
    guild,
    AuditLogEvent.MemberKick,
    member.id
  );

  if (!executor) return;
  if (isWhitelisted(guild.id, executor.id)) return;

  if (
    trackAction(
      guild.id,
      executor.id,
      "kick",
      config.limits.kick.amount,
      config.limits.kick.time
    )
  ) {
    await sendLog(
      guild,
      "🚨 ANTI-NUKE ACTIE",
      `**${executor.tag}** heeft te veel kicks uitgevoerd.`,
      0xff0000
    );

    await punish(
      guild,
      executor.id,
      "NexGuard Anti-Mass-Kick"
    );
  }
});

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  const guild = channel.guild;

  const executor = await getExecutor(
    guild,
    AuditLogEvent.ChannelDelete,
    channel.id
  );

  if (!executor) return;
  if (isWhitelisted(guild.id, executor.id)) return;

  if (
    trackAction(
      guild.id,
      executor.id,
      "channelDelete",
      config.limits.channelDelete.amount,
      config.limits.channelDelete.time
    )
  ) {
    await sendLog(
      guild,
      "🚨 ANTI-NUKE ACTIE",
      `**${executor.tag}** verwijderde te veel kanalen.`,
      0xff0000
    );

    await punish(
      guild,
      executor.id,
      "NexGuard Anti-Mass-Channel-Delete"
    );
  }
});

client.on("roleDelete", async role => {
  const guild = role.guild;

  const executor = await getExecutor(
    guild,
    AuditLogEvent.RoleDelete,
    role.id
  );

  if (!executor) return;
  if (isWhitelisted(guild.id, executor.id)) return;

  if (
    trackAction(
      guild.id,
      executor.id,
      "roleDelete",
      config.limits.roleDelete.amount,
      config.limits.roleDelete.time
    )
  ) {
    await sendLog(
      guild,
      "🚨 ANTI-NUKE ACTIE",
      `**${executor.tag}** verwijderde te veel rollen.`,
      0xff0000
    );

    await punish(
      guild,
      executor.id,
      "NexGuard Anti-Mass-Role-Delete"
    );
  }
});

client.on("roleCreate", async role => {
  const guild = role.guild;

  const executor = await getExecutor(
    guild,
    AuditLogEvent.RoleCreate,
    role.id
  );

  if (!executor) return;
  if (isWhitelisted(guild.id, executor.id)) return;

  if (
    trackAction(
      guild.id,
      executor.id,
      "roleCreate",
      config.limits.roleCreate.amount,
      config.limits.roleCreate.time
    )
  ) {
    await sendLog(
      guild,
      "🚨 ANTI-NUKE ACTIE",
      `**${executor.tag}** maakte te veel rollen aan.`,
      0xff0000
    );

    await punish(
      guild,
      executor.id,
      "NexGuard Anti-Mass-Role-Create"
    );
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN ontbreekt!");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
