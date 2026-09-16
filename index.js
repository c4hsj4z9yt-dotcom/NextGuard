const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType,
  ChannelType
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const logChannels = new Map();

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
      .setDescription("Stel NexGuard Security in."),

    new SlashCommandBuilder()
      .setName("security")
      .setDescription("Bekijk de NexGuard beveiligingsstatus.")
  ].map(command => command.toJSON());

  try {
    const rest = new REST({ version: "10" })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: commands
      }
    );

    console.log("✅ Slash commands geregistreerd.");
  } catch (error) {
    console.error("❌ Command registratie fout:", error);
  }
});

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  console.log(`📥 Command ontvangen: /${interaction.commandName}`);

  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ Deze command kan alleen in een server gebruikt worden.",
      ephemeral: true
    });
  }

  try {

    if (!interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )) {
      return interaction.reply({
        content: "❌ Je hebt Administrator nodig.",
        ephemeral: true
      });
    }

    // ==========================
    // SECURITY
    // ==========================

    if (interaction.commandName === "security") {

      return interaction.reply({
        content:
          "🛡️ **NEXGUARD SECURITY**\n\n" +
          "🟢 Bot online\n" +
          "🟢 Security systeem actief\n" +
          "🟢 Commands werken",
        ephemeral: true
      });
    }

    // ==========================
    // SETUP
    // ==========================

    if (interaction.commandName === "setup") {

      await interaction.deferReply({
        ephemeral: true
      });

      let channel = interaction.guild.channels.cache.find(
        channel =>
          channel.name === "nexguard-logs" &&
          channel.type === ChannelType.GuildText
      );

      if (!channel) {
        channel = await interaction.guild.channels.create({
          name: "nexguard-logs",
          type: ChannelType.GuildText,
          reason: "NexGuard Security Setup"
        });
      }

      logChannels.set(
        interaction.guild.id,
        channel.id
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff66)
        .setTitle("🛡️ NexGuard geactiveerd")
        .setDescription(
          `NexGuard is succesvol ingesteld door ${interaction.user}.`
        )
        .addFields(
          {
            name: "🛡️ Security",
            value: "🟢 Actief"
          },
          {
            name: "📋 Logs",
            value: `${channel}`
          }
        )
        .setTimestamp();

      await channel.send({
        embeds: [embed]
      });

      await interaction.editReply({
        content:
          "✅ **NexGuard is succesvol ingesteld!**\n\n" +
          `📋 Security logs: ${channel}\n` +
          "🛡️ Security systeem: 🟢 Actief"
      });

      console.log(
        `✅ NexGuard setup uitgevoerd in ${interaction.guild.name}`
      );

      return;
    }

  } catch (error) {

    console.error("❌ INTERACTION ERROR:");
    console.error(error);

    if (interaction.deferred) {

      await interaction.editReply({
        content:
          "❌ Er ging iets fout. Kijk in de bot-console."
      }).catch(() => {});

    } else if (!interaction.replied) {

      await interaction.reply({
        content:
          "❌ Er ging iets fout. Kijk in de bot-console."
      }).catch(() => {});
    }
  }
});

client.on("error", error => {
  console.error("❌ Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught exception:", error);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN ontbreekt!");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
