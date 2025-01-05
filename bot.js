// node bot.js to run
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType, REST, Routes } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Load environment variables
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TEST_CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID;
const BLUE_ROLE_ID = process.env.BLUE_ROLE_ID;

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Express server for Render compatibility
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Web service listening on port ${port}`));

// 📊 Color Tracking Data
let colorLog = [];

// 📊 Function to classify color into categories using Euclidean distance
function classifyColor(r, g, b) {
    const hsl = rgbToHsl(r, g, b);
    const hue = hsl[0];
    const colors = [
        { emoji: '<:red:1324226477268406353>', min: 0, max: 10 },
        { emoji: '<:orangered:1324226458465337365>', min: 10, max: 30 },
        { emoji: '<:orange:1324226439796621322>', min: 30, max: 50 },
        { emoji: '<:yelloworange:1324226423568728074>', min: 50, max: 70 },
        { emoji: '<:yellow:1324226408783810603>', min: 70, max: 90 },
        { emoji: '<:greenyellow:1324226389859373086>', min: 90, max: 120 },
        { emoji: '<:green:1324226357663633508>', min: 120, max: 150 },
        { emoji: '<:cyangreen:1324226321253142539>', min: 150, max: 170 },
        { emoji: '<:cyan:1324226273794461706>', min: 170, max: 190 },
        { emoji: '<:bluecyan:1324224790164144128>', min: 190, max: 210 },
        { emoji: '<:darkblue:1324224216651923519>', min: 210, max: 250 },
    ];
    return colors.find(color => hue >= color.min && hue < color.max)?.emoji || 'Unknown';
}

// 📊 Function to convert RGB to HSL
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? (g - b) / d + (g < b ? 6 : 0)
            : max === g ? (b - r) / d + 2
            : (r - g) / d + 4;
        h /= 6;
    }
    return [h * 360, s, l];
}

// 📊 Get Center Color
async function getCenterColor(page) {
    try {
        const screenshot = await page.screenshot({ fullPage: true, encoding: 'base64', timeout: 30000 });
        const color = await page.evaluate(screenshot => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + screenshot;
            return new Promise(resolve => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, img.width, img.height);
                    const pixel = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
                    resolve(pixel);
                };
            });
        }, screenshot);

        return classifyColor(color[0], color[1], color[2]);
    } catch (error) {
        console.error('Error fetching color:', error);
        return null;
    }
}

// 🚨 Monitor center color and send Discord alerts for "Blue"
async function monitorColor() {
    let browser, page, lastColor = null, blueAnnounced = false;
    async function launchBrowser() {
        if (browser) await browser.close();
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
        });
        page = await browser.newPage();
        await page.goto('https://global-mind.org/gcpdot/gcp.html', { waitUntil: 'networkidle0' });
    }

    await launchBrowser();

    setInterval(async () => {
        if (!page || page.isClosed()) {
            console.log("Page is closed, reopening...");
            await launchBrowser();
        }
        const color = await getCenterColor(page);
        if (color && color !== lastColor) {
            colorLog.push({ color, timestamp: Date.now() });
            let statusEmoji = '🔵';
            if (color === '<:red:1324226477268406353>') statusEmoji = '🔴';
            else if (['<:yellow:1324226408783810603>', '<:yelloworange:1324226423568728074>'].includes(color)) statusEmoji = '🟡';
            else if (['<:green:1324226357663633508>', '<:cyangreen:1324226321253142539>'].includes(color)) statusEmoji = '🟢';

            client.user.setPresence({
                activities: [{ name: `the dot: ${statusEmoji}`, type: ActivityType.Watching }],
                status: 'online',
            });

            if (['<:bluecyan:1324224790164144128>', '<:darkblue:1324224216651923519>'].includes(color) && !blueAnnounced) {
                const channel = await client.channels.fetch(CHANNEL_ID);
                await channel.send({
                    content: `<:darkblue:1324224216651923519> **The dot is blue!**`,
                    allowedMentions: { roles: [BLUE_ROLE_ID] }
                });
                blueAnnounced = true;
            } else if (!['<:bluecyan:1324224790164144128>', '<:darkblue:1324224216651923519>'].includes(color)) {
                blueAnnounced = false;
            }
            lastColor = color;
        }
    }, 15000);

    setInterval(async () => {
        console.log("Restarting browser...");
        await launchBrowser();
    }, 3600000);
}

// 🗨️ Commands
client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    
    /* Delete global commands

    const clientId = "1323744486811111473"; // bot's client ID here
    const commandId = "1324218706997542913"; // command ID to delete

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.delete(Routes.applicationCommand(clientId, commandId));
        console.log('Successfully deleted the global command');
    } catch (error) {
        console.error('Error deleting command:', error);
    }
    */

    // Register new command
    await client.application.commands.create(
        new SlashCommandBuilder().setName('dotcolor').setDescription('Get the current color of the dot!')
    );
    
    monitorColor();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'dotcolor') {
        await interaction.reply('🔍 Checking the dot, please wait...');
        const color = colorLog[colorLog.length - 1]?.color || 'Unknown';
        await interaction.editReply(`**The dot is** ${color} **right now**`);
    }
});

client.login(BOT_TOKEN);