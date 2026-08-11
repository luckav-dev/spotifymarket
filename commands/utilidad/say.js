'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  FileBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  CheckboxBuilder,
} = require('discord.js');

const COMMAND_NAME = 'say';
const SAY_BUILD = 'say';
const DATABASE_FILE = 'sayDatabase.json';
const MAX_UPLOADS = 5;
const MAX_LINK_BUTTONS = 5;

function findBotRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) return cwd;

  let current = __dirname;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return cwd;
}

const BOT_ROOT = findBotRoot();
const DB_PATH = process.env.SAY_DATABASE_PATH
  ? path.resolve(process.env.SAY_DATABASE_PATH)
  : path.join(BOT_ROOT, 'database', DATABASE_FILE);

function loadEmojiFile() {
  const candidates = [
    path.resolve(__dirname, '../configs/emojis.json'),
    path.resolve(__dirname, '../../configs/emojis.json'),
    path.resolve(__dirname, '../emojis.json'),
    path.resolve(__dirname, '../../emojis.json'),
    path.resolve(BOT_ROOT, 'configs/emojis.json'),
    path.resolve(BOT_ROOT, 'emojis.json'),
  ];

  for (const file of [...new Set(candidates)]) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      console.warn(`[say] No se pudo leer ${file}: ${error.message}`);
    }
  }

  console.warn('[say] No se encontró emojis.json. Se usarán emojis Unicode de respaldo.');
  return {};
}

// Emojis personalizados centralizados. No se define ningún Application Emoji nuevo.
const E = loadEmojiFile();
const EMOJI_SOURCE_KEYS = {
  warning:    'warning',
  signalHigh: 'signal_high',
  success:    'success',
  error:      'error',
  settings:   'settings',
  www:        'website',
  earth:      'usuarios',
  squadLogo:  'squad_logo',
  join:       'join',
  people:     'people',
  user:       'user',
  monitor:    'monitor',
  online:     'online',
  link:       'link',
  clock:      'clock',
  bell:       'notificacion',
  globe:      'world',
  map:        'update',
  seed:       'boost',
  arrow:      'reply',
};

// Catálogo de Application Emojis permitido por NOMBRE. Las IDs no se guardan
// aquí: se resuelven en tiempo de ejecución desde client.application.emojis.
const APPLICATION_EMOJI_NAMES = Object.freeze([
  'youtube', 'world', 'whitelist', 'wallet', 'video', 'update', 'uno', 'twitch',
  'tres', 'ticket', 'tada', 'stagerequesttospeak', 'signal_medium', 'signal_low',
  'serverpartner', 'rules', 'reply', 'question', 'premium', 'podcast', 'ping',
  'persona', 'paysafecard', 'paypal', 'oauth2', 'notificacion', 'nitro', 'new',
  'motivo', 'money1', 'mic', 'magicwand', 'loading', 'live', 'link', 'like',
  'kick', 'invite', 'heart', 'headphone', 'hammer', 'guardian', 'gift', 'folder',
  'fivem', 'files', 'estrellita', 'edit', 'download', 'dos', 'dislike',
  'discordnitro', 'discordmod', 'dinero', 'developer', 'delete', 'cuatro',
  'createchannels', 'corona', 'connect', 'cmd', 'clock', 'cinco', 'callconnect',
  'calendar', 'buscar', 'bots', 'boost', 'boatjoin', 'ban', 'awardcup', 'aviso',
  'announcements', 'administrator', 'add', 'online', 'user', 'people', 'monitor',
  'join', 'squad_logo', 'website', 'warning', 'usuarios', 'success', 'signal_high',
  'settings', 'error',
]);
const APPLICATION_EMOJI_NAME_SET = new Set(APPLICATION_EMOJI_NAMES);
const LIVE_APPLICATION_EMOJIS = new Map();

const EMOJI = {};

function refreshSemanticEmojiMap() {
  for (const [semantic, sourceKey] of Object.entries(EMOJI_SOURCE_KEYS)) {
    EMOJI[semantic] = E[sourceKey] || null;
  }
}

refreshSemanticEmojiMap();

let applicationEmojiHydrationPromise = null;

async function hydrateApplicationEmojis(client) {
  if (applicationEmojiHydrationPromise) return applicationEmojiHydrationPromise;

  applicationEmojiHydrationPromise = (async () => {
    try {
      const manager = client?.application?.emojis;
      if (!manager || typeof manager.fetch !== 'function') return;

      const emojis = await manager.fetch();
      LIVE_APPLICATION_EMOJIS.clear();

      for (const emoji of emojis.values()) {
        if (!emoji?.id || !emoji?.name) continue;
        LIVE_APPLICATION_EMOJIS.set(String(emoji.name).toLowerCase(), {
          id: String(emoji.id),
          name: String(emoji.name),
          animated: Boolean(emoji.animated),
        });

        // Sobrescribe cualquier ID vieja del JSON únicamente en memoria.
        // El archivo del usuario nunca se modifica.
        E[emoji.name] = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
      }

      refreshSemanticEmojiMap();
    } catch (error) {
      console.warn(`[say] No se pudieron cargar los Application Emojis: ${error.message}`);
    }
  })();

  return applicationEmojiHydrationPromise;
}

function liveEmojiByName(name) {
  const key = String(name || '').trim().toLowerCase();
  return key ? LIVE_APPLICATION_EMOJIS.get(key) || null : null;
}

function liveEmojiMention(name) {
  const emoji = liveEmojiByName(name);
  if (!emoji) return null;
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

// Permite escribir :warning:, :online:, :youtube:, etc. dentro del contenido.
// La ID se resuelve en tiempo de ejecución desde los Application Emojis del bot.
// Si el nombre no existe, el token se conserva tal cual y nunca rompe el mensaje.
function expandApplicationEmojiTokens(value) {
  const text = String(value ?? '');
  return text.replace(/(?<!<):([A-Za-z0-9_]{2,32}):/g, (token, name) => {
    const emoji = liveEmojiByName(name);
    return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : token;
  });
}

function normalizeEmojiName(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const mention = raw.match(/^<a?:([A-Za-z0-9_]{2,32}):\d{15,25}>$/);
  if (mention) return mention[1];

  const pair = raw.match(/^([A-Za-z0-9_]{2,32}):\d{15,25}$/);
  if (pair) return pair[1];

  if (/^[A-Za-z0-9_]{2,32}$/.test(raw)) return raw;
  return null;
}
const FALLBACK_EMOJI = {
  warning: '⚠️',
  signalHigh: '📶',
  success: '✅',
  error: '❌',
  settings: '⚙️',
  www: '🌐',
  earth: '🌍',
  squadLogo: '🛡️',
  join: '➡️',
  people: '👥',
  user: '👤',
  monitor: '🖥️',
  online: '🟢',
  link: '🔗',
  clock: '🕒',
  bell: '🔔',
  globe: '🌎',
  map: '🗺️',
  seed: '🚀',
  arrow: '↪️',
};

/* -------------------------------------------------------------------------- */
/*                                  EMOJIS                                    */
/* -------------------------------------------------------------------------- */

function emojiText(key, fallback = null) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return fallback || '';

  const appName = EMOJI_SOURCE_KEYS[rawKey] || normalizeEmojiName(rawKey) || rawKey;
  const live = liveEmojiMention(appName);
  if (live) return live;

  // Para el catálogo indicado por el usuario nunca confiamos en una ID fija
  // del JSON si no pudimos verificarla contra la aplicación actual.
  if (APPLICATION_EMOJI_NAME_SET.has(appName)) {
    return fallback || FALLBACK_EMOJI[rawKey] || '';
  }

  const configured = EMOJI[rawKey] || E[appName] || E[rawKey];
  return configured ? String(configured) : (fallback || FALLBACK_EMOJI[rawKey] || '');
}

function emojiComponent(keyOrValue, fallback = null) {
  const rawInput = keyOrValue && typeof keyOrValue === 'object'
    ? keyOrValue
    : String(keyOrValue ?? '').trim();

  if (rawInput && typeof rawInput === 'object') {
    const name = normalizeEmojiName(rawInput.name || '');
    const live = name ? liveEmojiByName(name) : null;
    if (live) return live;

    if (rawInput.id && /^\d{15,25}$/.test(String(rawInput.id))) {
      return {
        id: String(rawInput.id),
        name: name || undefined,
        animated: Boolean(rawInput.animated),
      };
    }
    if (rawInput.name && isUnicodeEmoji(rawInput.name)) return { name: String(rawInput.name) };
    return fallback ? emojiComponent(fallback, null) : null;
  }

  if (!rawInput) return fallback ? emojiComponent(fallback, null) : null;

  const semanticName = EMOJI_SOURCE_KEYS[rawInput] || normalizeEmojiName(rawInput) || rawInput;
  const live = liveEmojiByName(semanticName);
  if (live) return live;

  // Si es uno de nuestros nombres de Application Emoji y no está disponible
  // en la aplicación actual, no mandamos ninguna ID potencialmente obsoleta.
  if (APPLICATION_EMOJI_NAME_SET.has(semanticName)) {
    return fallback ? emojiComponent(fallback, null) : null;
  }

  const configured = EMOJI[rawInput] || E[semanticName] || E[rawInput];
  if (configured && configured !== rawInput) return emojiComponent(configured, fallback);

  const customMention = rawInput.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/);
  if (customMention) {
    const liveByMentionName = liveEmojiByName(customMention[2]);
    if (liveByMentionName) return liveByMentionName;
    return { id: customMention[3], name: customMention[2], animated: customMention[1] === 'a' };
  }

  const customPair = rawInput.match(/^([A-Za-z0-9_]{2,32}):(\d{15,25})$/);
  if (customPair) {
    const liveByPairName = liveEmojiByName(customPair[1]);
    if (liveByPairName) return liveByPairName;
    return { id: customPair[2], name: customPair[1], animated: false };
  }

  if (isUnicodeEmoji(rawInput)) return { name: rawInput };
  return fallback ? emojiComponent(fallback, null) : null;
}

function isUnicodeEmoji(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 32) return false;

  // Cubre emoji pictográfico, emoji con presentación propia, flags, keycaps,
  // variation selector y secuencias ZWJ. Evita aceptar palabras como "online".
  return /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u20E3)/u.test(text);
}

function withEmoji(builder, key, fallback) {
  try {
    const resolved = emojiComponent(key, fallback);
    if (resolved) builder.setEmoji(resolved);
  } catch {
    // Un emoji nunca debe romper el /say completo.
  }
  return builder;
}

/* -------------------------------------------------------------------------- */
/*                              BASE DE DATOS                                 */
/* -------------------------------------------------------------------------- */

function defaultDatabase() {
  return {
    version: 2,
    drafts: {},
  };
}

function ensureDbDirectory() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function readDatabase() {
  ensureDbDirectory();

  if (!fs.existsSync(DB_PATH)) {
    const initial = defaultDatabase();
    writeDatabase(initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    parsed.version ||= 2;
    parsed.drafts ||= {};
    return parsed;
  } catch (error) {
    const backup = `${DB_PATH}.corrupt-${Date.now()}.bak`;
    try { fs.copyFileSync(DB_PATH, backup); } catch {}
    console.error(`[say] Base de datos dañada. Copia creada en ${backup}:`, error);
    const fresh = defaultDatabase();
    writeDatabase(fresh);
    return fresh;
  }
}

function writeDatabase(db) {
  ensureDbDirectory();
  const temp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(temp, DB_PATH);
}

function draftKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function createDefaultDraft(userId, guildId, channelId) {
  return {
    userId,
    guildId,
    channelId,
    editorSchemaVersion: 2,
    iconKey: null,
    title: '',
    subtitle: '',
    body: '',
    footer: '',
    layout: 'classic',
    extras: [],
    useContainer: true,
    mediaUrl: '',
    thumbnailUrl: '',
    uploadedFiles: [],
    buttons: [],
    sideCta: null,
    audienceUsers: [],
    audienceRoles: [],
    audienceMixedUsers: [],
    audienceMixedRoles: [],
    audienceEveryone: false,
    version: 1,
    previewVersion: 0,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDraft(draft) {
  // Migra los textos/estilo de ejemplo que usaban las versiones anteriores.
  if (draft.editorSchemaVersion !== 2) {
    if (draft.title === 'Nuevo mensaje') draft.title = '';
    if (draft.subtitle === 'Edita el contenido desde el panel') draft.subtitle = '';
    if (draft.body === 'Escribe aquí el mensaje que quieres publicar.') draft.body = '';
    draft.editorSchemaVersion = 2;
  }

  draft.extras = Array.isArray(draft.extras) ? [...new Set(draft.extras)] : [];
  draft.uploadedFiles = Array.isArray(draft.uploadedFiles) ? draft.uploadedFiles.slice(0, MAX_UPLOADS) : [];
  draft.buttons = Array.isArray(draft.buttons) ? draft.buttons.slice(0, MAX_LINK_BUTTONS) : [];
  draft.audienceUsers = Array.isArray(draft.audienceUsers) ? [...new Set(draft.audienceUsers.map(String))].slice(0, 5) : [];
  draft.audienceRoles = Array.isArray(draft.audienceRoles) ? [...new Set(draft.audienceRoles.map(String))].slice(0, 5) : [];
  draft.audienceMixedUsers = Array.isArray(draft.audienceMixedUsers) ? [...new Set(draft.audienceMixedUsers.map(String))].slice(0, 5) : [];
  draft.audienceMixedRoles = Array.isArray(draft.audienceMixedRoles) ? [...new Set(draft.audienceMixedRoles.map(String))].slice(0, 5) : [];
  draft.audienceEveryone = Boolean(draft.audienceEveryone);
  draft.layout = ['classic', 'compact', 'hero'].includes(draft.layout) ? draft.layout : 'classic';
  draft.useContainer = draft.useContainer !== false;
  draft.iconKey = normalizeEmojiName(draft.iconKey);
  draft.version = Number.isFinite(Number(draft.version)) ? Number(draft.version) : 1;
  draft.previewVersion = Number.isFinite(Number(draft.previewVersion)) ? Number(draft.previewVersion) : 0;
  return draft;
}

function loadDraft(guildId, userId) {
  const db = readDatabase();
  const draft = db.drafts[draftKey(guildId, userId)];
  return draft ? normalizeDraft(draft) : null;
}

function saveDraft(draft, bump = true) {
  const db = readDatabase();
  const next = normalizeDraft({ ...draft });
  if (bump) next.version += 1;
  next.updatedAt = new Date().toISOString();
  db.drafts[draftKey(next.guildId, next.userId)] = next;
  writeDatabase(db);
  return next;
}

function removeDraft(guildId, userId) {
  const db = readDatabase();
  delete db.drafts[draftKey(guildId, userId)];
  writeDatabase(db);
}

/* -------------------------------------------------------------------------- */
/*                              HELPERS VISUALES                              */
/* -------------------------------------------------------------------------- */

function textDisplay(content) {
  return new TextDisplayBuilder().setContent(String(content || '').slice(0, 4000));
}

function addSeparator(target, large = false, divider = true) {
  target.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(divider)
      .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small)
  );
  return target;
}

function actionRow(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

function setSectionButtonAccessory(section, button) {
  if (typeof section.setButtonAccessory === 'function') {
    section.setButtonAccessory(button);
    return section;
  }

  const json = typeof button?.toJSON === 'function' ? button.toJSON() : button;
  const style = json?.style;
  const methods = {
    [ButtonStyle.Primary]: 'setPrimaryButtonAccessory',
    [ButtonStyle.Secondary]: 'setSecondaryButtonAccessory',
    [ButtonStyle.Success]: 'setSuccessButtonAccessory',
    [ButtonStyle.Danger]: 'setDangerButtonAccessory',
    [ButtonStyle.Link]: 'setLinkButtonAccessory',
  };
  const method = methods[style];
  if (!method || typeof section[method] !== 'function') {
    throw new Error(`SectionBuilder no soporta un botón accessory con style ${style}.`);
  }
  section[method](json);
  return section;
}

function sectionWithButton(content, button) {
  const section = new SectionBuilder().addTextDisplayComponents(textDisplay(content));
  return setSectionButtonAccessory(section, button);
}

function isUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function hasImageExtension(value) {
  return /\.(png|jpe?g|gif|webp|avif)(?:\?.*)?$/i.test(String(value || ''));
}

function hasMediaExtension(value) {
  return /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)(?:\?.*)?$/i.test(String(value || ''));
}

function isMediaAttachment(file) {
  const type = String(file?.contentType || '').toLowerCase();
  return type.startsWith('image/') || type.startsWith('video/') || hasMediaExtension(file?.name || file?.url);
}

function sanitizeFilename(input, fallback = 'archivo.bin') {
  const base = path.basename(String(input || fallback));
  const cleaned = base.replace(/[^A-Za-z0-9._()\- ]+/g, '_').slice(0, 120);
  return cleaned || fallback;
}

function splitBody(body) {
  const chunks = [];
  let current = [];

  for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*\/\/\/\/+\s*$/.test(line)) {
      if (current.join('\n').trim()) chunks.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }

  if (current.join('\n').trim()) chunks.push(current.join('\n').trim());
  return chunks.slice(0, 7);
}

function hasExtra(draft, extra) {
  return Array.isArray(draft.extras) && draft.extras.includes(extra);
}

function previewIsCurrent(draft) {
  return draft.previewVersion === draft.version;
}

function editorHeaderSection(draft, client) {
  const section = new SectionBuilder().addTextDisplayComponents(textDisplay([
    `# ${emojiText('monitor', '🖥️')} /say`,
    '-# Crea, revisa y publica mensajes con Components V2.',
  ].join('\n')));

  const avatar = client?.user?.displayAvatarURL?.({ extension: 'png', size: 256 });
  if (avatar) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(avatar)
        .setDescription(client.user.username || 'Bot')
    );
  }

  return section;
}

function buildChannelSelector(draft) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('say_channel_select')
    .setPlaceholder('Canal de destino')
    .setMinValues(1)
    .setMaxValues(1)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  if (draft.channelId && typeof select.setDefaultChannels === 'function') {
    try { select.setDefaultChannels(draft.channelId); } catch {}
  }

  return select;
}

function buildEditorComponents(draft, client) {
  const container = new ContainerBuilder();
  container.addSectionComponents(editorHeaderSection(draft, client));
  addSeparator(container);

  const hasContent = Boolean(draft.title || draft.body || draft.mediaUrl || draft.uploadedFiles.length || draft.buttons.length || draft.sideCta);
  const previewState = previewIsCurrent(draft)
    ? `${emojiText('success', '✅')} Actualizada`
    : `${emojiText('warning', '⚠️')} Pendiente`;

  const summary = [
    `${emojiText('announcements', '📢')} **Canal:** ${draft.channelId ? `<#${draft.channelId}>` : 'Sin seleccionar'}`,
    `${emojiText('edit', '✏️')} **Contenido:** ${hasContent ? (draft.title ? `\`${draft.title.slice(0, 50)}\`` : 'Configurado') : 'Vacío'}`,
    `${emojiText('monitor', '🖥️')} **Vista previa:** ${previewState}`,
  ];
  container.addTextDisplayComponents(textDisplay(summary.join('\n')));
  container.addActionRowComponents(actionRow(buildChannelSelector(draft)));

  addSeparator(container);

  container.addSectionComponents(
    sectionWithButton(
      `### ${emojiText('edit', '✏️')} Contenido
-# Título, texto y pie del mensaje.`,
      withEmoji(new ButtonBuilder().setCustomId('say_edit_content').setLabel('Editar').setStyle(ButtonStyle.Secondary), 'edit', '✏️')
    )
  );

  container.addActionRowComponents(actionRow(
    withEmoji(new ButtonBuilder().setCustomId('say_edit_media').setLabel('Multimedia').setStyle(ButtonStyle.Secondary), 'files', '📁'),
    withEmoji(new ButtonBuilder().setCustomId('say_edit_buttons').setLabel('Botones').setStyle(ButtonStyle.Secondary), 'link', '🔗'),
    withEmoji(new ButtonBuilder().setCustomId('say_edit_audience').setLabel('Menciones').setStyle(ButtonStyle.Secondary), 'people', '👥'),
    withEmoji(new ButtonBuilder().setCustomId('say_edit_style').setLabel('Apariencia').setStyle(ButtonStyle.Secondary), 'settings', '⚙️')
  ));

  addSeparator(container);

  container.addActionRowComponents(actionRow(
    withEmoji(new ButtonBuilder().setCustomId('say_preview').setLabel('Previsualizar').setStyle(ButtonStyle.Primary), 'monitor', '🖥️'),
    withEmoji(
      new ButtonBuilder()
        .setCustomId('say_send')
        .setLabel('Publicar')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!previewIsCurrent(draft) || !draft.channelId),
      'success', '✅'
    ),
    withEmoji(new ButtonBuilder().setCustomId('say_reset').setLabel('Limpiar').setStyle(ButtonStyle.Secondary), 'delete', '🗑️'),
    withEmoji(new ButtonBuilder().setCustomId('say_close').setLabel('Cerrar').setStyle(ButtonStyle.Danger), 'error', '✖️')
  ));

  return [container];
}

function createComponentSink() {
  const components = [];
  const add = (...items) => {
    for (const item of items.flat()) if (item) components.push(item);
  };
  return {
    components,
    addTextDisplayComponents: (...items) => add(...items),
    addSectionComponents: (...items) => add(...items),
    addSeparatorComponents: (...items) => add(...items),
    addMediaGalleryComponents: (...items) => add(...items),
    addFileComponents: (...items) => add(...items),
    addActionRowComponents: (...items) => add(...items),
  };
}

function addMediaGallery(target, draft) {
  const sources = [];

  if (isUrl(draft.mediaUrl) && hasMediaExtension(draft.mediaUrl)) {
    sources.push({ url: draft.mediaUrl, description: draft.title || 'Multimedia' });
  }

  for (const file of draft.uploadedFiles.filter(isMediaAttachment)) {
    if (isUrl(file.url)) sources.push({ url: file.url, description: file.name || 'Multimedia' });
  }

  if (!sources.length) return false;

  const gallery = new MediaGalleryBuilder();
  for (const source of sources.slice(0, 10)) {
    gallery.addItems(
      new MediaGalleryItemBuilder()
        .setURL(source.url)
        .setDescription(String(source.description || 'Multimedia').slice(0, 1024))
        .setSpoiler(hasExtra(draft, 'spoiler'))
    );
  }
  target.addMediaGalleryComponents(gallery);
  return true;
}

function addHeader(target, draft) {
  const title = expandApplicationEmojiTokens(String(draft.title || '').trim());
  const subtitle = expandApplicationEmojiTokens(String(draft.subtitle || '').trim());
  const icon = draft.iconKey ? emojiText(draft.iconKey, '') : '';
  const heading = [
    title ? `# ${icon ? `${icon} ` : ''}${title}` : '',
    subtitle ? `**${subtitle}**` : '',
  ].filter(Boolean).join('\n');

  const validThumb = isUrl(draft.thumbnailUrl) && (hasImageExtension(draft.thumbnailUrl) || /^https:\/\//i.test(draft.thumbnailUrl));
  if (validThumb) {
    target.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(textDisplay(heading || '​'))
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(draft.thumbnailUrl)
            .setDescription(String(title || 'Miniatura').slice(0, 1024))
            .setSpoiler(hasExtra(draft, 'spoiler'))
        )
    );
    return true;
  }

  if (heading) {
    target.addTextDisplayComponents(textDisplay(heading));
    return true;
  }

  return false;
}

function combinedAudience(draft) {
  const users = [...new Set([...(draft.audienceUsers || []), ...(draft.audienceMixedUsers || [])])].slice(0, 10);
  const roles = [...new Set([...(draft.audienceRoles || []), ...(draft.audienceMixedRoles || [])])].slice(0, 10);
  return { users, roles, everyone: Boolean(draft.audienceEveryone) };
}

function addAudience(target, draft) {
  const audience = combinedAudience(draft);
  const mentions = [
    ...audience.users.map(id => `<@${id}>`),
    ...audience.roles.map(id => `<@&${id}>`),
    ...(audience.everyone ? ['@everyone'] : []),
  ];
  if (!mentions.length) return;
  if (hasExtra(draft, 'separators')) addSeparator(target);
  target.addTextDisplayComponents(textDisplay(`${emojiText('people')} **Destinatarios:** ${mentions.join(' ')}`));
}

function addBody(target, draft) {
  const chunks = splitBody(draft.body);
  if (!chunks.length) return;

  for (let index = 0; index < chunks.length; index += 1) {
    if (index > 0 && hasExtra(draft, 'separators')) addSeparator(target);
    target.addTextDisplayComponents(textDisplay(expandApplicationEmojiTokens(chunks[index])));
  }

  if (draft.mediaUrl && isUrl(draft.mediaUrl) && !hasMediaExtension(draft.mediaUrl)) {
    if (hasExtra(draft, 'separators')) addSeparator(target);
    target.addTextDisplayComponents(textDisplay(`${emojiText('www')} **Enlace multimedia:** ${draft.mediaUrl}`));
  }
}

function buildLinkButton(item) {
  const button = new ButtonBuilder()
    .setLabel(String(item.label || 'Abrir').slice(0, 80))
    .setURL(item.url)
    .setStyle(ButtonStyle.Link);
  if (item.emoji) withEmoji(button, item.emoji, '🔗');
  return button;
}

function addSideCta(target, draft) {
  const cta = draft.sideCta;
  if (!cta || !isUrl(cta.url)) return;
  if (hasExtra(draft, 'separators')) addSeparator(target);

  const button = new ButtonBuilder()
    .setLabel(String(cta.label || 'Abrir').slice(0, 80))
    .setURL(cta.url)
    .setStyle(ButtonStyle.Link);
  if (cta.emoji) withEmoji(button, cta.emoji, '🔗');

  target.addSectionComponents(
    sectionWithButton([
      `## ${emojiText('arrow', '↪️')} ${expandApplicationEmojiTokens(cta.title)}`,
      expandApplicationEmojiTokens(cta.description || ''),
    ].join('\n'), button)
  );
}

function addLinkButtons(target, draft) {
  const valid = draft.buttons.filter(button => button?.label && isUrl(button?.url)).slice(0, MAX_LINK_BUTTONS);
  if (!valid.length) return;
  if (hasExtra(draft, 'separators')) addSeparator(target);
  target.addActionRowComponents(actionRow(...valid.map(buildLinkButton)));
}

function addFileComponents(target, draft, attachedFileNames = [], preview = false) {
  const docs = draft.uploadedFiles.filter(file => !isMediaAttachment(file)).slice(0, MAX_UPLOADS);
  if (!docs.length) return;

  if (hasExtra(draft, 'separators')) addSeparator(target);

  if (preview || !attachedFileNames.length) {
    target.addTextDisplayComponents(textDisplay(
      `### ${emojiText('earth')} Archivos adjuntos\n${docs.map(file => `- \`${sanitizeFilename(file.name)}\``).join('\n')}\n-# Se adjuntarán al publicar el mensaje.`
    ));
    return;
  }

  for (const filename of attachedFileNames.slice(0, docs.length)) {
    target.addFileComponents(
      new FileBuilder()
        .setURL(`attachment://${filename}`)
        .setSpoiler(hasExtra(draft, 'spoiler'))
    );
  }
}

function addFooter(target, draft) {
  const lines = [];
  if (hasExtra(draft, 'footer') && draft.footer) lines.push(expandApplicationEmojiTokens(draft.footer));
  if (hasExtra(draft, 'timestamp')) lines.push(`${emojiText('clock')} <t:${Math.floor(Date.now() / 1000)}:R>`);
  if (!lines.length) return;

  if (hasExtra(draft, 'separators')) addSeparator(target);
  target.addTextDisplayComponents(textDisplay(`-# ${lines.join(' · ')}`));
}

function composeFinal(target, draft, { attachedFileNames = [], preview = false } = {}) {
  const mediaFirst = draft.layout === 'hero';

  if (mediaFirst) {
    const added = addMediaGallery(target, draft);
    if (added && hasExtra(draft, 'separators')) addSeparator(target, true);
  }

  addHeader(target, draft);
  addAudience(target, draft);
  if (hasExtra(draft, 'separators')) addSeparator(target);
  addBody(target, draft);
  addSideCta(target, draft);

  if (!mediaFirst) {
    const hasAnyMedia = (isUrl(draft.mediaUrl) && hasMediaExtension(draft.mediaUrl)) || draft.uploadedFiles.some(isMediaAttachment);
    if (hasAnyMedia && hasExtra(draft, 'separators')) addSeparator(target);
    addMediaGallery(target, draft);
  }

  addFileComponents(target, draft, attachedFileNames, preview);
  addLinkButtons(target, draft);
  addFooter(target, draft);
  return target;
}

function buildPublicComponents(draft, options = {}) {
  if (draft.useContainer !== false) {
    const container = new ContainerBuilder().setSpoiler(false);
    composeFinal(container, draft, options);
    return [container];
  }

  const sink = createComponentSink();
  composeFinal(sink, draft, options);
  return sink.components.slice(0, 40);
}

function buildPreviewComponents(draft, client) {
  const components = buildPublicComponents(draft, { preview: true });
  const controls = new ContainerBuilder();
  controls.addTextDisplayComponents(textDisplay(
    `## ${emojiText('monitor', '🖥️')} Vista previa\n-# Revisa el resultado antes de publicarlo.`
  ));
  addSeparator(controls);
  controls.addActionRowComponents(actionRow(
    withEmoji(new ButtonBuilder().setCustomId('say_back').setLabel('Volver al editor').setStyle(ButtonStyle.Secondary), 'arrow', '↪️'),
    withEmoji(new ButtonBuilder().setCustomId('say_send').setLabel('Enviar ahora').setStyle(ButtonStyle.Success).setDisabled(!draft.channelId), 'success', '✅'),
    withEmoji(new ButtonBuilder().setCustomId('say_close').setLabel('Cerrar').setStyle(ButtonStyle.Danger), 'error', '❌'),
  ));
  components.push(controls);
  return components;
}

function buildNotice(kind, title, message, details = []) {
  const success = kind === 'success';
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(textDisplay([
    `# ${emojiText(success ? 'success' : 'error')} ${title}`,
    message ? `**${message}**` : '',
    ...details.map(item => `${emojiText('arrow')} ${item}`),
  ].filter(Boolean).join('\n')));
  return [container];
}

function buildProgressComponents(title, message) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(textDisplay([
    `## ${emojiText('loading', '⏳')} ${title}`,
    `-# ${message}`,
  ].join('\n')));
  return [container];
}

function progressPayload(title, message, ephemeral = false) {
  return {
    components: buildProgressComponents(title, message),
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  };
}

function editorPayload(draft, client) {
  return {
    components: buildEditorComponents(draft, client),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function componentUpdatePayload(components) {
  return {
    components,
    allowedMentions: { parse: [] },
  };
}

function ephemeralNoticePayload(kind, title, message, details = []) {
  return {
    components: buildNotice(kind, title, message, details),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

/* -------------------------------------------------------------------------- */
/*                                   MODALES                                  */
/* -------------------------------------------------------------------------- */

function contentModal(draft) {
  return new ModalBuilder()
    .setCustomId('say_modal_content')
    .setTitle('Contenido del mensaje')
    .addTextDisplayComponents(textDisplay(
      `# ${emojiText('edit', '✏️')} Contenido\n-# Usa Markdown. Escribe \`:emoji:\` para usar un Application Emoji por nombre. \`////\` separa bloques.`
    ))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Título')
        .setDescription('Encabezado principal del mensaje.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_title')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(80)
            .setValue(String(draft.title || '').slice(0, 80))
        ),
      new LabelBuilder()
        .setLabel('Subtítulo')
        .setDescription('Opcional. Aparece debajo del título.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_subtitle')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(120)
            .setValue(String(draft.subtitle || '').slice(0, 120))
        ),
      new LabelBuilder()
        .setLabel('Mensaje')
        .setDescription('Markdown, menciones y :emoji: por nombre del Developer Portal.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_body')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(3000)
            .setValue(String(draft.body || '').slice(0, 3000))
        ),
      new LabelBuilder()
        .setLabel('Pie del mensaje')
        .setDescription('Opcional. Solo aparece si activas “Pie” en apariencia.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_footer')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(120)
            .setValue(String(draft.footer || '').slice(0, 120))
        ),
    );
}

function mediaModal(draft) {
  return new ModalBuilder()
    .setCustomId('say_modal_media')
    .setTitle('Multimedia y archivos')
    .addTextDisplayComponents(textDisplay(
      `# ${emojiText('earth')} Multimedia\nPuedes combinar URL, miniatura y archivos subidos directamente desde Discord.`
    ))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('URL de imagen o vídeo')
        .setDescription('Opcional. Usa preferiblemente una URL directa.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_media_url')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(1000)
            .setValue(String(draft.mediaUrl || '').slice(0, 1000))
        ),
      new LabelBuilder()
        .setLabel('URL de miniatura')
        .setDescription('Opcional. Se muestra junto al encabezado.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_thumbnail_url')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(1000)
            .setValue(String(draft.thumbnailUrl || '').slice(0, 1000))
        ),
      new LabelBuilder()
        .setLabel('Subir archivos')
        .setDescription(`Opcional. Hasta ${MAX_UPLOADS} archivos.`)
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId('say_uploads')
            .setMinValues(0)
            .setMaxValues(MAX_UPLOADS)
            .setRequired(false)
        ),
      new LabelBuilder()
        .setLabel('Reemplazar archivos anteriores')
        .setDescription('Marcado: sustituye los archivos guardados en el borrador.')
        .setCheckboxComponent(
          new CheckboxBuilder()
            .setCustomId('say_replace_uploads')
            .setDefault(false)
        ),
    );
}

function buttonsModal(draft) {
  const buttonsValue = draft.buttons
    .map(button => `${button.label} || ${button.url} || ${button.emoji || 'link'}`)
    .join('\n');

  const cta = draft.sideCta
    ? `${draft.sideCta.title || ''} || ${draft.sideCta.description || ''} || ${draft.sideCta.label || ''} || ${draft.sideCta.url || ''} || ${draft.sideCta.emoji || 'link'}`
    : '';

  return new ModalBuilder()
    .setCustomId('say_modal_buttons')
    .setTitle('Botones y CTA')
    .addTextDisplayComponents(textDisplay(
      `# ${emojiText('link', '🔗')} Botones\n-# En el campo emoji escribe solo el nombre del Application Emoji, por ejemplo \`link\`, \`success\` o \`youtube\`. Nunca necesitas una ID.`
    ))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Botones Link')
        .setDescription(`Uno por línea: Texto || URL || emoji. Máximo ${MAX_LINK_BUTTONS}.`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_buttons')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1800)
            .setValue(buttonsValue.slice(0, 1800))
        ),
      new LabelBuilder()
        .setLabel('CTA lateral')
        .setDescription('Título || descripción || botón || URL || emoji')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('say_side_cta')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setValue(cta.slice(0, 1000))
        ),
    );
}

function audienceModal(draft) {
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('say_audience_users')
    .setPlaceholder('Usuarios concretos…')
    .setMinValues(0)
    .setMaxValues(5)
    .setRequired(false);
  if (draft.audienceUsers?.length) userSelect.setDefaultUsers(...draft.audienceUsers.slice(0, 5));

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('say_audience_roles')
    .setPlaceholder('Roles concretos…')
    .setMinValues(0)
    .setMaxValues(5)
    .setRequired(false);
  if (draft.audienceRoles?.length) roleSelect.setDefaultRoles(...draft.audienceRoles.slice(0, 5));

  const mixedSelect = new MentionableSelectMenuBuilder()
    .setCustomId('say_audience_mixed')
    .setPlaceholder('Usuarios o roles adicionales…')
    .setMinValues(0)
    .setMaxValues(5)
    .setRequired(false);
  if (draft.audienceMixedUsers?.length) mixedSelect.addDefaultUsers(...draft.audienceMixedUsers.slice(0, 5));
  if (draft.audienceMixedRoles?.length) mixedSelect.addDefaultRoles(...draft.audienceMixedRoles.slice(0, 5));

  return new ModalBuilder()
    .setCustomId('say_modal_audience')
    .setTitle('Destinatarios y menciones')
    .addTextDisplayComponents(textDisplay(
      `# ${emojiText('people')} Destinatarios\nLos elementos seleccionados se insertan en el mensaje. Activa “Permitir menciones” en Apariencia para que generen ping.`
    ))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Usuarios')
        .setDescription('Selecciona hasta 5 usuarios concretos.')
        .setUserSelectMenuComponent(userSelect),
      new LabelBuilder()
        .setLabel('Roles')
        .setDescription('Selecciona hasta 5 roles concretos.')
        .setRoleSelectMenuComponent(roleSelect),
      new LabelBuilder()
        .setLabel('Mentionables adicionales')
        .setDescription('Selector mixto de usuarios y roles.')
        .setMentionableSelectMenuComponent(mixedSelect),
      new LabelBuilder()
        .setLabel('Añadir @everyone')
        .setDescription('Se insertará @everyone; solo hará ping si las menciones están activadas.')
        .setCheckboxComponent(
          new CheckboxBuilder()
            .setCustomId('say_audience_everyone')
            .setDefault(Boolean(draft.audienceEveryone))
        ),
    );
}

function styleModal(draft) {
  const selected = new Set(draft.extras || []);
  const modal = new ModalBuilder()
    .setCustomId('say_modal_style')
    .setTitle('Apariencia')
    .addTextDisplayComponents(textDisplay(
      `# ${emojiText('settings', '⚙️')} Apariencia
-# Elige la estructura y los extras del mensaje. El diseño no utiliza barra de acento.`
    ));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Diseño')
      .setDescription('Orden del contenido y la multimedia.')
      .setRadioGroupComponent(
        new RadioGroupBuilder()
          .setCustomId('say_layout')
          .setRequired(true)
          .addOptions(
            new RadioGroupOptionBuilder().setLabel('Clásico').setValue('classic').setDescription('Texto primero.').setDefault(draft.layout === 'classic'),
            new RadioGroupOptionBuilder().setLabel('Compacto').setValue('compact').setDescription('Contenido más condensado.').setDefault(draft.layout === 'compact'),
            new RadioGroupOptionBuilder().setLabel('Visual').setValue('hero').setDescription('Multimedia primero.').setDefault(draft.layout === 'hero')
          )
      ),
    new LabelBuilder()
      .setLabel('Extras')
      .setDescription('Activa únicamente lo que necesites.')
      .setCheckboxGroupComponent(
        new CheckboxGroupBuilder()
          .setCustomId('say_extras')
          .setRequired(false)
          .setMinValues(0)
          .setMaxValues(6)
          .addOptions(
            new CheckboxGroupOptionBuilder().setLabel('Container V2').setValue('container').setDescription('Agrupa el mensaje en un Container.').setDefault(draft.useContainer !== false),
            new CheckboxGroupOptionBuilder().setLabel('Separadores').setValue('separators').setDefault(selected.has('separators')),
            new CheckboxGroupOptionBuilder().setLabel('Pie').setValue('footer').setDefault(selected.has('footer')),
            new CheckboxGroupOptionBuilder().setLabel('Marca temporal').setValue('timestamp').setDefault(selected.has('timestamp')),
            new CheckboxGroupOptionBuilder().setLabel('Permitir menciones').setValue('mentions').setDefault(selected.has('mentions')),
            new CheckboxGroupOptionBuilder().setLabel('Multimedia en spoiler').setValue('spoiler').setDefault(selected.has('spoiler'))
          )
      ),
    new LabelBuilder()
      .setLabel('Icono del título')
      .setDescription('Solo nombre: warning, online, youtube, squad_logo…')
      .setTextInputComponent((() => {
        const input = new TextInputBuilder()
          .setCustomId('say_icon_name')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32)
          .setPlaceholder('Nombre del Application Emoji');
        if (draft.iconKey) input.setValue(String(draft.iconKey).slice(0, 32));
        return input;
      })())
  );

  return modal;
}

/* -------------------------------------------------------------------------- */
/*                               PARSEO DE INPUT                              */
/* -------------------------------------------------------------------------- */

function parseButtons(raw) {
  return String(raw || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, MAX_LINK_BUTTONS)
    .map(line => {
      const parts = line.split('||').map(part => part.trim());
      const label = parts[0];
      const url = parts[1];
      const emoji = normalizeEmojiName(parts[2] || 'link') || 'link';
      if (!label || !isUrl(url)) return null;
      return {
        label: label.slice(0, 80),
        url: url.slice(0, 1000),
        emoji,
      };
    })
    .filter(Boolean);
}

function parseSideCta(raw) {
  const line = String(raw || '').trim();
  if (!line) return null;
  const parts = line.split('||').map(part => part.trim());
  if (parts.length < 4) return null;

  const [title, description, label, url, emoji = 'link'] = parts;
  if (!title || !label || !isUrl(url)) return null;

  return {
    title: title.slice(0, 120),
    description: description.slice(0, 700),
    label: label.slice(0, 80),
    url: url.slice(0, 1000),
    emoji: normalizeEmojiName(emoji) || 'link',
  };
}

function uploadedFilesFromModal(interaction) {
  if (typeof interaction.fields?.getUploadedFiles !== 'function') return [];
  try {
    const files = interaction.fields.getUploadedFiles('say_uploads', false);
    if (!files) return [];
    return [...files.values()].slice(0, MAX_UPLOADS).map(file => ({
      id: file.id,
      name: sanitizeFilename(file.name || `archivo-${file.id}`),
      url: file.url,
      proxyURL: file.proxyURL || '',
      contentType: file.contentType || '',
      size: Number(file.size) || 0,
    }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*                         PREPARACIÓN DE ARCHIVOS                            */
/* -------------------------------------------------------------------------- */

async function prepareDocumentAttachments(draft) {
  const docs = draft.uploadedFiles.filter(file => !isMediaAttachment(file)).slice(0, MAX_UPLOADS);
  const files = [];
  const names = [];

  for (let index = 0; index < docs.length; index += 1) {
    const file = docs[index];
    const source = file.url || file.proxyURL;
    if (!isUrl(source)) continue;

    const response = await fetch(source);
    if (!response.ok) throw new Error(`No se pudo descargar ${file.name} (${response.status})`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const original = sanitizeFilename(file.name || `archivo-${index + 1}.bin`);
    const unique = `${String(index + 1).padStart(2, '0')}-${original}`;
    files.push({ attachment: buffer, name: unique });
    names.push(unique);
  }

  return { files, names };
}

/* -------------------------------------------------------------------------- */
/*                            RESPUESTAS / ERRORES                            */
/* -------------------------------------------------------------------------- */

async function updateInteraction(interaction, components) {
  const payload = componentUpdatePayload(components);

  if (!interaction.replied && !interaction.deferred && typeof interaction.update === 'function') {
    return interaction.update(payload);
  }

  if (interaction.deferred && typeof interaction.editReply === 'function') {
    return interaction.editReply(payload);
  }

  if (!interaction.replied) {
    return interaction.reply({
      ...payload,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  }

  return interaction.followUp({
    ...payload,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

async function showError(interaction, title, message, details = []) {
  const payload = ephemeralNoticePayload('error', title, message, details);
  try {
    if (interaction.deferred && typeof interaction.editReply === 'function') return await interaction.editReply({ components: payload.components });
    if (interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (error) {
    console.error('[say] No se pudo mostrar un error al usuario:', error);
    return null;
  }
}

function ensurePermission(interaction) {
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages)
    || interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages));
}

async function getInteractionGuildMember(interaction) {
  if (!interaction?.guild || !interaction?.user?.id) return null;

  const cached = interaction.guild.members?.cache?.get(interaction.user.id);
  if (cached) return cached;

  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

function memberRoleNames(member) {
  if (!member?.roles?.cache) return [];
  return member.roles.cache
    .filter(role => role.id !== member.guild.id)
    .map(role => role.name)
    .sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Valida el canal usando los permisos EFECTIVOS del miembro.
 * Discord calcula estos permisos a partir de @everyone + todos los roles del
 * miembro + overwrites del canal. Si existiera un overwrite individual,
 * Discord también lo respeta como capa final de seguridad.
 */
async function getMemberChannelPublishAccess(interaction, channel) {
  if (!channel?.guild || channel.guild.id !== interaction.guildId) {
    return { ok: false, reason: 'Ese canal no pertenece a este servidor.', member: null, permissions: null };
  }

  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return { ok: false, reason: 'El canal seleccionado no permite publicar mensajes.', member: null, permissions: null };
  }

  const member = await getInteractionGuildMember(interaction);
  if (!member) {
    return { ok: false, reason: 'No se pudieron comprobar tus roles en el servidor.', member: null, permissions: null };
  }

  // permissionsFor(member) combina los permisos de TODOS sus roles y los
  // overwrites del canal. Es más seguro que comprobar un único rol manualmente.
  const permissions = channel.permissionsFor?.(member, true) || null;
  if (!permissions) {
    return { ok: false, reason: 'No se pudieron calcular tus permisos para este canal.', member, permissions: null };
  }

  const canView = permissions.has(PermissionFlagsBits.ViewChannel);
  const canSend = permissions.has(PermissionFlagsBits.SendMessages);

  if (!canView || !canSend) {
    const missing = [];
    if (!canView) missing.push('Ver canal');
    if (!canSend) missing.push('Enviar mensajes');
    return {
      ok: false,
      reason: `Tus roles no te conceden ${missing.join(' y ')} en ${channel}.`,
      member,
      permissions,
      roles: memberRoleNames(member),
    };
  }

  return { ok: true, member, permissions, roles: memberRoleNames(member) };
}

function ensureGuild(interaction) {
  return Boolean(interaction.guildId && interaction.guild);
}

function validateV2Support() {
  const required = {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    FileBuilder,
    LabelBuilder,
    FileUploadBuilder,
    RadioGroupBuilder,
    CheckboxGroupBuilder,
    CheckboxBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder,
  };

  const missing = Object.entries(required).filter(([, value]) => typeof value !== 'function').map(([name]) => name);
  return missing;
}

const CLAIMED_INTERACTIONS = new WeakSet();

function claimInteraction(interaction) {
  if (CLAIMED_INTERACTIONS.has(interaction)) return false;
  CLAIMED_INTERACTIONS.add(interaction);
  return true;
}

/* -------------------------------------------------------------------------- */
/*                              LÓGICA DEL COMANDO                            */
/* -------------------------------------------------------------------------- */

async function getOrCreateDraft(interaction) {
  let draft = loadDraft(interaction.guildId, interaction.user.id);
  const optionChannel = interaction.options?.getChannel?.('channel') || null;

  if (!draft) {
    draft = createDefaultDraft(
      interaction.user.id,
      interaction.guildId,
      null
    );
  }

  // Si el usuario indicó canal explícitamente, jamás se guarda hasta validar
  // sus permisos efectivos derivados de roles/overwrites.
  if (optionChannel) {
    const access = await getMemberChannelPublishAccess(interaction, optionChannel);
    if (!access.ok) {
      return { draft: saveDraft(draft, false), channelError: access };
    }

    if (draft.channelId !== optionChannel.id) {
      draft.channelId = optionChannel.id;
      draft = saveDraft(draft, true);
    } else {
      draft = saveDraft(draft, false);
    }

    return { draft, channelError: null };
  }

  // Un borrador antiguo puede apuntar a un canal al que el usuario ya no tiene
  // acceso (por ejemplo, porque perdió un rol). Se invalida automáticamente.
  if (draft.channelId) {
    const existing = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
    const access = existing ? await getMemberChannelPublishAccess(interaction, existing) : { ok: false };
    if (!access.ok) {
      draft.channelId = null;
      draft.previewVersion = 0;
      draft = saveDraft(draft, true);
    }
  }

  // Solo usamos el canal actual como destino inicial si los roles del usuario
  // permiten realmente ver y enviar mensajes en él.
  if (!draft.channelId && interaction.channel) {
    const currentAccess = await getMemberChannelPublishAccess(interaction, interaction.channel);
    if (currentAccess.ok) {
      draft.channelId = interaction.channel.id;
      draft = saveDraft(draft, false);
    } else {
      draft = saveDraft(draft, false);
    }
  } else if (!draft.updatedAt) {
    draft = saveDraft(draft, false);
  }

  return { draft, channelError: null };
}

function draftHasPublishableContent(draft) {
  return Boolean(
    String(draft.title || '').trim()
    || String(draft.body || '').trim()
    || (isUrl(draft.mediaUrl) && draft.mediaUrl)
    || (draft.uploadedFiles || []).length
    || (draft.buttons || []).some(button => button?.label && isUrl(button?.url))
    || (draft.sideCta && isUrl(draft.sideCta.url))
  );
}

async function sendDraft(interaction, draft) {
  if (!previewIsCurrent(draft)) {
    return showError(interaction, 'Vista previa desactualizada', 'Genera una nueva vista previa antes de publicar.');
  }

  const channel = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return showError(interaction, 'Canal no disponible', 'No se pudo acceder al canal de destino.');
  }

  // SEGURIDAD: el usuario solo puede publicar donde SUS permisos efectivos,
  // calculados a partir de roles + overwrites del canal, se lo permiten.
  const memberAccess = await getMemberChannelPublishAccess(interaction, channel);
  if (!memberAccess.ok) {
    return showError(
      interaction,
      'No puedes publicar en ese canal',
      memberAccess.reason || 'Tus roles no tienen permisos suficientes en el canal de destino.',
      memberAccess.roles?.length
        ? [`Roles comprobados: ${memberAccess.roles.slice(0, 8).map(role => `\`${role}\``).join(', ')}`]
        : []
    );
  }

  // Después comprobamos también al bot. Ambos deben poder publicar.
  const botMember = interaction.guild.members.me;
  const botPerms = channel.permissionsFor?.(botMember);
  if (botPerms && (!botPerms.has(PermissionFlagsBits.ViewChannel) || !botPerms.has(PermissionFlagsBits.SendMessages))) {
    return showError(interaction, 'Faltan permisos', 'El bot necesita Ver canal y Enviar mensajes en el canal de destino.');
  }

  // Feedback inmediato antes de descargar adjuntos/construir/enviar el mensaje.
  // El usuario siempre ve este estado antes del resultado final.
  try {
    await updateInteraction(
      interaction,
      buildProgressComponents('Publicando mensaje…', `Enviando el mensaje en ${channel}. Espere un momento.`)
    );
  } catch (error) {
    console.warn('[say] No se pudo mostrar el estado de publicación:', error.message || error);
  }

  try {
    const prepared = await prepareDocumentAttachments(draft);
    const publicComponents = buildPublicComponents(draft, {
      attachedFileNames: prepared.names,
      preview: false,
    });

    const audience = combinedAudience(draft);
    const allowedMentions = hasExtra(draft, 'mentions')
      ? {
          parse: audience.everyone ? ['everyone'] : [],
          users: audience.users,
          roles: audience.roles,
          repliedUser: false,
        }
      : { parse: [], users: [], roles: [], repliedUser: false };

    const sent = await channel.send({
      components: publicComponents,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions,
      ...(prepared.files.length ? { files: prepared.files } : {}),
    });

    removeDraft(interaction.guildId, interaction.user.id);

    const success = buildNotice('success', 'Mensaje publicado', `Se ha enviado correctamente en ${channel}.`, [
      `${emojiText('link')} ID: \`${sent.id}\``,
      `${emojiText('clock')} Publicado <t:${Math.floor(Date.now() / 1000)}:R>`,
    ]);

    // sendDraft ya sustituyó el editor por el estado "Publicando...", así que
    // editamos ese mismo mensaje en vez de generar un follow-up adicional.
    if (typeof interaction.editReply === 'function') {
      return interaction.editReply({ components: success, allowedMentions: { parse: [] } });
    }

    return updateInteraction(interaction, success);
  } catch (error) {
    console.error('[say] Error publicando mensaje:', error);
    const errorComponents = buildNotice('error', 'No se pudo publicar', 'Discord rechazó el mensaje o falló un archivo.', [
      `Error: \`${String(error.message || error).slice(0, 300)}\``,
    ]);

    if (typeof interaction.editReply === 'function') {
      return interaction.editReply({ components: errorComponents, allowedMentions: { parse: [] } });
    }

    return showError(interaction, 'No se pudo publicar', String(error.message || error));
  }
}

const exportedCommand = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Create and publish advanced messages with Discord Components V2')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(option => option
      .setName('channel')
      .setDescription('Channel where the message will be published')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false)),

  async execute(interaction) {
    if (!ensureGuild(interaction)) {
      return showError(interaction, 'Solo servidores', 'Este comando solo funciona dentro de un servidor.');
    }

    if (!ensurePermission(interaction)) {
      return showError(interaction, 'Sin permisos', 'Necesitas el permiso Gestionar mensajes para utilizar /say.');
    }

    const missing = validateV2Support();
    if (missing.length) {
      return showError(
        interaction,
        'discord.js desactualizado',
        'Este /say necesita una versión moderna de discord.js con Components V2.',
        [`Faltan: ${missing.join(', ')}`, 'Recomendado: discord.js 14.26.4 o superior.']
      );
    }

    // Primero respondemos con un estado visible de carga. Así la interacción
    // queda reconocida inmediatamente y el usuario sabe que se está preparando.
    await interaction.reply(progressPayload(
      'Cargando editor…',
      'Preparando el Container y tus permisos. Espere un momento.',
      true
    ));

    // Después cargamos Application Emojis y el borrador.
    await hydrateApplicationEmojis(interaction.client);

    const { draft, channelError } = await getOrCreateDraft(interaction);
    if (channelError) {
      const denied = buildNotice(
        'error',
        'Canal no permitido',
        channelError.reason || 'Tus roles no permiten publicar en el canal seleccionado.',
        channelError.roles?.length
          ? [`Roles comprobados: ${channelError.roles.slice(0, 8).map(role => `\`${role}\``).join(', ')}`]
          : []
      );
      return interaction.editReply({ components: denied, allowedMentions: { parse: [] } });
    }

    return interaction.editReply({
      components: buildEditorComponents(draft, interaction.client),
      allowedMentions: { parse: [] },
    });
  },

  async handleButton(interaction) {
    if (!claimInteraction(interaction)) return;
    if (!String(interaction.customId || '').startsWith('say_')) return;

    if (!ensureGuild(interaction) || !ensurePermission(interaction)) {
      return showError(interaction, 'Sin permisos', 'No puedes utilizar este editor.');
    }

    let draft = loadDraft(interaction.guildId, interaction.user.id);
    if (!draft && !['say_close'].includes(interaction.customId)) {
      return showError(interaction, 'Borrador no encontrado', 'Ejecuta /say para abrir un editor nuevo.');
    }

    switch (interaction.customId) {
      case 'say_noop':
        return interaction.deferUpdate().catch(() => null);

      case 'say_edit_content':
        return interaction.showModal(contentModal(draft));

      case 'say_edit_media':
        return interaction.showModal(mediaModal(draft));

      case 'say_edit_buttons':
        return interaction.showModal(buttonsModal(draft));

      case 'say_edit_audience':
        return interaction.showModal(audienceModal(draft));

      case 'say_edit_style':
        return interaction.showModal(styleModal(draft));

      case 'say_preview': {
        if (!draftHasPublishableContent(draft)) {
          return showError(interaction, 'Mensaje vacío', 'Añade contenido, multimedia, archivos o botones antes de previsualizar.');
        }
        draft.previewVersion = draft.version;
        draft = saveDraft(draft, false);
        return updateInteraction(interaction, buildPreviewComponents(draft, interaction.client));
      }

      case 'say_back':
        return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));

      case 'say_send':
        return sendDraft(interaction, draft);

      case 'say_reset': {
        const reset = createDefaultDraft(interaction.user.id, interaction.guildId, draft.channelId || interaction.channelId);
        const saved = saveDraft(reset, false);
        return updateInteraction(interaction, buildEditorComponents(saved, interaction.client));
      }

      case 'say_close':
        removeDraft(interaction.guildId, interaction.user.id);
        return updateInteraction(
          interaction,
          buildNotice('success', 'Editor cerrado', 'El borrador de /say se ha eliminado.')
        );

      default:
        return null;
    }
  },

  async handleSelect(interaction) {
    if (!claimInteraction(interaction)) return;
    if (!String(interaction.customId || '').startsWith('say_')) return;

    if (!ensureGuild(interaction) || !ensurePermission(interaction)) {
      return showError(interaction, 'Sin permisos', 'No puedes utilizar este editor.');
    }

    let draft = loadDraft(interaction.guildId, interaction.user.id);
    if (!draft) return showError(interaction, 'Borrador no encontrado', 'Ejecuta /say otra vez.');

    if (interaction.customId === 'say_channel_select') {
      const channelId = interaction.values?.[0];
      const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
      if (!channel?.isTextBased?.()) return showError(interaction, 'Canal inválido', 'Selecciona un canal de texto o anuncios.');

      const access = await getMemberChannelPublishAccess(interaction, channel);
      if (!access.ok) {
        return showError(
          interaction,
          'Canal no permitido',
          access.reason || 'Tus roles no te permiten publicar en ese canal.',
          access.roles?.length
            ? [`Roles comprobados: ${access.roles.slice(0, 8).map(role => `\`${role}\``).join(', ')}`]
            : []
        );
      }

      draft.channelId = channel.id;
      draft = saveDraft(draft, true);
      return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));
    }

    return null;
  },

  async handleModal(interaction) {
    if (!claimInteraction(interaction)) return;
    if (!String(interaction.customId || '').startsWith('say_modal_')) return;

    if (!ensureGuild(interaction) || !ensurePermission(interaction)) {
      return showError(interaction, 'Sin permisos', 'No puedes modificar este borrador.');
    }

    let draft = loadDraft(interaction.guildId, interaction.user.id);
    if (!draft) return showError(interaction, 'Borrador no encontrado', 'Ejecuta /say otra vez.');

    if (interaction.customId === 'say_modal_content') {
      draft.title = interaction.fields.getTextInputValue('say_title').trim();
      draft.subtitle = interaction.fields.getTextInputValue('say_subtitle').trim();
      draft.body = interaction.fields.getTextInputValue('say_body').trim();
      draft.footer = interaction.fields.getTextInputValue('say_footer').trim();
      draft = saveDraft(draft, true);
      return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));
    }

    if (interaction.customId === 'say_modal_media') {
      draft.mediaUrl = interaction.fields.getTextInputValue('say_media_url').trim();
      draft.thumbnailUrl = interaction.fields.getTextInputValue('say_thumbnail_url').trim();

      const uploads = uploadedFilesFromModal(interaction);
      let replace = false;
      if (typeof interaction.fields.getCheckbox === 'function') {
        try { replace = interaction.fields.getCheckbox('say_replace_uploads'); } catch { replace = false; }
      }

      if (replace) draft.uploadedFiles = uploads;
      else if (uploads.length) {
        const combined = [...draft.uploadedFiles, ...uploads];
        const seen = new Set();
        draft.uploadedFiles = combined.filter(file => {
          const key = file.id || file.url;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(-MAX_UPLOADS);
      }

      draft = saveDraft(draft, true);
      return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));
    }

    if (interaction.customId === 'say_modal_buttons') {
      draft.buttons = parseButtons(interaction.fields.getTextInputValue('say_buttons'));
      draft.sideCta = parseSideCta(interaction.fields.getTextInputValue('say_side_cta'));
      draft = saveDraft(draft, true);
      return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));
    }

    if (interaction.customId === 'say_modal_audience') {
      try {
        const users = interaction.fields.getSelectedUsers('say_audience_users', false);
        draft.audienceUsers = users ? [...users.keys()] : [];
      } catch { draft.audienceUsers = []; }

      try {
        const roles = interaction.fields.getSelectedRoles('say_audience_roles', false);
        draft.audienceRoles = roles ? [...roles.keys()] : [];
      } catch { draft.audienceRoles = []; }

      try {
        const mixed = interaction.fields.getSelectedMentionables('say_audience_mixed', false);
        draft.audienceMixedUsers = mixed?.users ? [...mixed.users.keys()] : [];
        draft.audienceMixedRoles = mixed?.roles ? [...mixed.roles.keys()] : [];
      } catch {
        draft.audienceMixedUsers = [];
        draft.audienceMixedRoles = [];
      }

      try { draft.audienceEveryone = interaction.fields.getCheckbox('say_audience_everyone'); }
      catch { draft.audienceEveryone = false; }

      draft = saveDraft(draft, true);
      return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));
    }

    if (interaction.customId === 'say_modal_style') {
      let layout = 'classic';
      let extras = [];

      if (typeof interaction.fields.getRadioGroup === 'function') {
        try { layout = interaction.fields.getRadioGroup('say_layout', true) || 'classic'; } catch {}
      }

      if (typeof interaction.fields.getCheckboxGroup === 'function') {
        try { extras = [...(interaction.fields.getCheckboxGroup('say_extras') || [])]; } catch { extras = []; }
      }

      const useContainer = extras.includes('container');
      extras = extras.filter(value => value !== 'container');

      draft.layout = ['classic', 'compact', 'hero'].includes(layout) ? layout : 'classic';
      draft.extras = extras;
      draft.useContainer = useContainer;
      draft.iconKey = normalizeEmojiName(interaction.fields.getTextInputValue('say_icon_name'));
      draft = saveDraft(draft, true);
      return updateInteraction(interaction, buildEditorComponents(draft, interaction.client));
    }

    return null;
  },
};

module.exports = exportedCommand;
