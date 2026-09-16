const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  AuditLogEvent,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType,
  ChannelType
} = require("discord.js");

const config = require("./config.json");

// ==========================================
// NEXGUARD SECURITY BOT
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ==========================================
// DATA
// ==========================================

const whitelist = new Map();
const logChannels = new Map();

const actionTracker = new Map();
const raidTracker = new Map();

// ==========================================
// WHITELIST
// ==========================================

function isWhitelisted(guildId, userId) {
  if (userId === client.user?.id) return true;

  return whitelist.get(guildId)?.has(userId) ?? false;
}

// ==========================================
// ACTION TRACKER
// ==========================================

function trackAction(guildId, userId, action, amount, time) {
  const key = `${guildId}:${userId}:${action}`;
  const now = Date.now();

  const actions = (actionTracker.get(key) || [])
    .filter(timestamp => now - timestamp < time);

  actions.push(now);

  actionTracker.set(key, actions);

  return actions.length >= amount;
}

// ==========================================
// RAID TRACKER
// ==========================================

function trackRaid(guildId) {
  const now = Date.now();

  const joins = (raidTracker.get(guildId) || [])
    .filter(timestamp => {
      return now - timestamp < config.raid.time;
    });

  joins.push(now);

  raidTracker.set(guildId, joins);

  return joins.length >= config.raid.amount;
}

// ==========================================
// LOGGING
// ==========================================

async function sendLog(
  guild,
  title,
  description,
  color = 0xff0000
) {
  try {
    const channelId = logChannels.get(guild.id);

    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp()
      .setFooter({
        text: "NexGuard Security"
      });

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {
    console.error("Log error:", error);
  }
}

// ==========================================
// AUDIT LOG
// ==========================================

async function getExecutor(
  guild,
  type,
  targetId
) {
  try {
    const logs = await guild.fetchAuditLogs({
      type,
      limit: 5
    });

    const entry = logs.entries.find(entry => {

      const correctTarget =
        !targetId ||
        entry.target?.id === targetId;

      const recent =
        Date.now() - entry.createdTimestamp < 10000;

      return correctTarget && recent;
    });

    return entry?.executor || null;

  } catch (error) {
    console.error("Audit log error:", error);
    return null;
  }
}

// ==========================================
// PUNISH
// ==========================================

async function punish(
  guild,
  userId,
  reason
) {
  try {

    const member =
      await guild.members.fetch(userId).catch(() => null);

    if (!member) return;

    if (!member.kickable) {

      await sendLog(
        guild,
        "⚠️ NexGuard kon niet ingrijpen",
        `**${member.user.tag}** kon niet worden verwijderd.\n\n` +
        `Controleer de rolvolgorde van NexGuard.`,
        0xffa500
      );

      return;
    }

    await member.kick(reason);

    await sendLog(
      guild,
      "🛡️ NexGuard heeft ingegrepen",
      `**Gebruiker:** ${member.user.tag}\n` +
      `**Actie:** Kick\n` +
      `**Reden:** ${reason}`,
      0x00ff66
    );

  } catch (error) {
    console.error("Punish error:", error);
  }
}

// ==========================================
// BOT READY
// ==========================================

client.once("ready", async () => {

  console.log("=================================");
  console.log("        NEXGUARD ONLINE");
  console.log("=================================");
  console.log(`Bot: ${client.user.tag}`);
  console.log(`Servers: ${client.guilds.cache.size}`);

  client.user.setPresence({
    activities: [
      {
        name: "🛡️ Server Security",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });

  // ========================================
  // SLASH COMMANDS
  // ========================================

  const commands = [

    new SlashCommandBuilder()
      .setName("setup")
      .setDescription(
        "Stel NexGuard Security in."
      ),

    new SlashCommandBuilder()
      .setName("security")
      .setDescription(
        "Bekijk de beveiligingsstatus."
      ),

    new SlashCommandBuilder()
      .setName("whitelist")
      .setDescription(
        "Voeg een gebruiker toe aan de whitelist."
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription(
            "De gebruiker die je wilt whitelisten."
          )
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("unwhitelist")
      .setDescription(
        "Verwijder een gebruiker van de whitelist."
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription(
            "De gebruiker."
          )
          .setRequired(true)
      )

  ].map(command => command.toJSON());

  // ========================================
  // REGISTER COMMANDS
  // ========================================

  try {

    const rest = new REST({
      version: "10"
    }).setToken(
      process.env.DISCORD_TOKEN
    );

    await rest.put(
      Routes.applicationCommands(
        client.user.id
      ),
      {
        body: commands
      }
    );

    console.log("✅ Slash commands geregistreerd.");

  } catch (error) {

    console.error(
      "❌ Slash commands konden niet geregistreerd worden:",
      error
    );
  }
});

// ==========================================
// INTERACTIONS
// ==========================================

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!interaction.guild) {
      return interaction.reply({
        content:
          "❌ Deze command kan alleen in een server gebruikt worden.",
        ephemeral: true
      });
    }

    try {

      // ======================================
      // ADMIN CHECK
      // ======================================

      if (
        !interaction.member.permissions.has(
          PermissionsBitField.Flags.Administrator
        )
      ) {

        return interaction.reply({
          content:
            "❌ Je hebt **Administrator** nodig om NexGuard te beheren.",
          ephemeral: true
        });
      }

      const guild = interaction.guild;

      // ======================================
      // SETUP
      // ======================================

      if (
        interaction.commandName === "setup"
      ) {

        await interaction.deferReply({
          ephemeral: true
        });

        let channel =
          guild.channels.cache.find(
            channel =>
              channel.name === "nexguard-logs" &&
              channel.isTextBased()
          );

        // Maak logkanaal
        if (!channel) {

          channel =
            await guild.channels.create({
              name: "nexguard-logs",
              type: ChannelType.GuildText,
              reason:
                "NexGuard security logs"
            });

        }

        logChannels.set(
          guild.id,
          channel.id
        );

        await interaction.editReply({
          content:
            "✅ **NexGuard is succesvol ingesteld!**\n\n" +
            `📋 Logs: ${channel}\n` +
            "🛡️ Anti-Nuke: 🟢 Aan\n" +
            "🚨 Anti-Raid: 🟢 Aan\n" +
            "🤖 Anti-Bot: 🟢 Aan\n" +
            "🔨 Anti-Mass Ban/Kick: 🟢 Aan"
        });

        await sendLog(
          guild,
          "🛡️ NexGuard geactiveerd",
          `NexGuard is ingesteld door **${interaction.user.tag}**.`,
          0x00ff66
        );

        return;
      }

      // ======================================
      // SECURITY
      // ======================================

      if (
        interaction.commandName === "security"
      ) {

        return interaction.reply({

          content:
            "🛡️ **NEXGUARD SECURITY STATUS**\n\n" +

            "🟢 Anti-Nuke\n" +
            "🟢 Anti-Raid\n" +
            "🟢 Anti-Mass Ban\n" +
            "🟢 Anti-Mass Kick\n" +
            "🟢 Anti-Channel Delete\n" +
            "🟢 Anti-Role Delete\n" +
            "🟢 Anti-Role Create\n" +
            "🟢 Anti-Bot\n" +
            "🟢 Security Logs",

          ephemeral: true
        });
      }

      // ======================================
      // WHITELIST
      // ======================================

      if (
        interaction.commandName === "whitelist"
      ) {

        const user =
          interaction.options.getUser("user");

        if (!whitelist.has(guild.id)) {

          whitelist.set(
            guild.id,
            new Set()
          );

        }

        whitelist
          .get(guild.id)
          .add(user.id);

        return interaction.reply({
          content:
            `✅ **${user.tag}** staat nu op de NexGuard whitelist.`,
          ephemeral: true
        });
      }

      // ======================================
      // UNWHITELIST
      // ======================================

      if (
        interaction.commandName === "unwhitelist"
      ) {

        const user =
          interaction.options.getUser("user");

        whitelist
          .get(guild.id)
          ?.delete(user.id);

        return interaction.reply({
          content:
            `✅ **${user.tag}** is van de NexGuard whitelist verwijderd.`,
          ephemeral: true
        });
      }

    } catch (error) {

      console.error(
        "❌ Interaction error:",
        error
      );

      if (
        interaction.replied ||
        interaction.deferred
      ) {

        await interaction.editReply({
          content:
            "❌ Er ging iets fout bij het uitvoeren van deze command. Controleer de bot-console."
        }).catch(() => {});

      } else {

        await interaction.reply({
          content:
            "❌ Er ging iets fout bij NexGuard.",
          ephemeral: true
        }).catch(() => {});

      }
    }
  }
);

// ==========================================
// ANTI-BOT
// ==========================================

client.on(
  "guildMemberAdd",
  async member => {

    try {

      if (
        config.antiBot &&
        member.user.bot
      ) {

        await sendLog(
          member.guild,
          "🤖 Nieuwe bot gedetecteerd",
          `**${member.user.tag}** is toegetreden en wordt gecontroleerd.`,
          0xffa500
        );

        if (member.kickable) {

          await member.kick(
            "NexGuard Anti-Bot"
          );

        }

        return;
      }

      // ====================================
      // ANTI-RAID
      // ====================================

      if (
        config.antiRaid &&
        trackRaid(member.guild.id)
      ) {

        await sendLog(
          member.guild,
          "🚨 MOGELIJKE RAID GEDETECTEERD",
          "Er zijn in korte tijd veel leden toegetreden.",
          0xff0000
        );
      }

    } catch (error) {

      console.error(
        "GuildMemberAdd error:",
        error
      );
    }
  }
);

// ==========================================
// ANTI-MASS BAN
// ==========================================

client.on(
  "guildBanAdd",
  async ban => {

    try {

      const guild = ban.guild;

      const executor =
        await getExecutor(
          guild,
          AuditLogEvent.MemberBanAdd,
          ban.user.id
        );

      if (!executor) return;

      if (
        isWhitelisted(
          guild.id,
          executor.id
        )
      ) return;

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

    } catch (error) {

      console.error(
        "Ban protection error:",
        error
      );
    }
  }
);

// ==========================================
// ANTI-MASS KICK
// ==========================================

client.on(
  "guildMemberRemove",
  async member => {

    try {

      const guild = member.guild;

      const executor =
        await getExecutor(
          guild,
          AuditLogEvent.MemberKick,
          member.id
        );

      if (!executor) return;

      if (
        isWhitelisted(
          guild.id,
          executor.id
        )
      ) return;

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

    } catch (error) {

      console.error(
        "Kick protection error:",
        error
      );
    }
  }
);

// ==========================================
// ANTI CHANNEL DELETE
// ==========================================

client.on(
  "channelDelete",
  async channel => {

    try {

      const guild = channel.guild;

      const executor =
        await getExecutor(
          guild,
          AuditLogEvent.ChannelDelete,
          channel.id
        );

      if (!executor) return;

      if (
        isWhitelisted(
          guild.id,
          executor.id
        )
      ) return;

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

    } catch (error) {

      console.error(
        "Channel delete protection error:",
        error
      );
    }
  }
);

// ==========================================
// ANTI ROLE DELETE
// ==========================================

client.on(
  "roleDelete",
  async role => {

    try {

      const guild = role.guild;

      const executor =
        await getExecutor(
          guild,
          AuditLogEvent.RoleDelete,
          role.id
        );

      if (!executor) return;

      if (
        isWhitelisted(
          guild.id,
          executor.id
        )
      ) return;

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

    } catch (error) {

      console.error(
        "Role delete protection error:",
        error
      );
    }
  }
);

// ==========================================
// ANTI ROLE CREATE
// ==========================================

client.on(
  "roleCreate",
  async role => {

    try {

      const guild = role.guild;

      const executor =
        await getExecutor(
          guild,
          AuditLogEvent.RoleCreate,
          role.id
        );

      if (!executor) return;

      if (
        isWhitelisted(
          guild.id,
          executor.id
        )
      ) return;

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

    } catch (error) {

      console.error(
        "Role create protection error:",
        error
      );
    }
  }
);

// ==========================================
// ERRORS
// ==========================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

client.on(
  "error",
  error => {
    console.error(
      "Discord client error:",
      error
    );
  }
);

// ==========================================
// TOKEN
// ==========================================

if (!process.env.DISCORD_TOKEN) {

  console.error(
    "❌ DISCORD_TOKEN ontbreekt!"
  );

  process.exit(1);
}

// ==========================================
// LOGIN
// ==========================================

client.login(
  process.env.DISCORD_TOKEN
);
