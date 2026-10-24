/**
 * supabase.js - Robust Database & Diagnostic Manager with Leaderboard Support
 */

window.DB_LOGS = window.DB_LOGS || [];

window.logDB = function(level, message, data = null) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    level: level,
    message: message,
    data: data
  };
  window.DB_LOGS.push(entry);
  console.log(`[DB ${level}] ${message}`, data || '');

  if (typeof window.onNewDBLog === 'function') {
    window.onNewDBLog(entry);
  }
};

window.logDB('INFO', 'supabase.js loaded.');

const DEFAULT_URL = "https://vefkmqcpoawbijynbsbl.supabase.co";
const DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlZmttcWNwb2F3YmlqeW5ic2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MTE4OTksImV4cCI6MjEwODI4Nzg5OX0.20YADd_ZmyayvXb4FUuG5T2QdUftGzI2D9-B_1O8VPA";

const SUPABASE_URL = (window.ENV && window.ENV.SUPABASE_URL && window.ENV.SUPABASE_URL.trim() !== "") 
  ? window.ENV.SUPABASE_URL.trim() 
  : DEFAULT_URL;

const SUPABASE_ANON_KEY = (window.ENV && window.ENV.SUPABASE_ANON_KEY && window.ENV.SUPABASE_ANON_KEY.trim() !== "") 
  ? window.ENV.SUPABASE_ANON_KEY.trim() 
  : DEFAULT_KEY;

let supabaseClient = null;

try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.logDB('SUCCESS', `Supabase client initialized for ${SUPABASE_URL}`);
  } else {
    window.logDB('ERROR', 'window.supabase is missing. Check CDN script.');
  }
} catch (err) {
  window.logDB('ERROR', `Failed to create Supabase client: ${err.message}`, err);
}

window.DB = {
  getDeviceId() {
    let devId = localStorage.getItem('roblox_noob_device_uid');
    if (!devId) {
      devId = (window.crypto && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('roblox_noob_device_uid', devId);
      window.logDB('INFO', `Assigned new Device UID: ${devId}`);
    }
    return devId;
  },

  async testConnection() {
    window.logDB('INFO', '--- Testing Supabase Connection ---');
    if (!supabaseClient) {
      window.logDB('ERROR', 'Cannot test connection: Supabase client is null.');
      return { ok: false, error: 'Client not initialized' };
    }

    try {
      const { data, error, status } = await supabaseClient
        .from('profiles')
        .select('device_id')
        .limit(1);

      if (error) {
        window.logDB('ERROR', `Supabase query error [${error.code}]: ${error.message}`);
        return { ok: false, error: error.message };
      }

      window.logDB('SUCCESS', `Table "profiles" connected (HTTP ${status}).`);
      const deviceId = this.getDeviceId();
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

      return { ok: true, profile };
    } catch (netErr) {
      window.logDB('ERROR', `Network failure: ${netErr.message}`);
      return { ok: false, error: netErr.message };
    }
  },

  async getDeviceProfile() {
    if (!supabaseClient) return null;
    try {
      const deviceId = this.getDeviceId();
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (error) {
        window.logDB('ERROR', `getDeviceProfile: ${error.message}`);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  },

  async registerDeviceProfile(characterData) {
    if (!supabaseClient) throw new Error("Supabase client is not initialized.");
    const deviceId = this.getDeviceId();
    window.logDB('INFO', `Registering character: ${characterData.username}`);

    const { data, error } = await supabaseClient
      .from('profiles')
      .insert([
        {
          device_id: deviceId,
          username: characterData.username,
          torso_color: characterData.torsoColor || '#0055bf',
          head_color: characterData.headColor || '#ffe800',
          hat: characterData.hat || 'hat_none',
          coins: 0,
          first_game_done: false
        }
      ])
      .select()
      .single();

    if (error) {
      window.logDB('ERROR', `Registration failed [${error.code}]: ${error.message}`);
      throw error;
    }

    window.logDB('SUCCESS', `Character "${characterData.username}" registered in DB!`);
    return data;
  },

  async updateAttributes(updates) {
    if (!supabaseClient) return null;
    try {
      const deviceId = this.getDeviceId();
      const { data, error } = await supabaseClient
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('device_id', deviceId)
        .select()
        .single();

      if (error) {
        window.logDB('ERROR', `updateAttributes: ${error.message}`);
      }
      return data;
    } catch (e) {
      return null;
    }
  },

  // Change 2: Fetch Leaderboard of all registered players
  async getLeaderboard(limit = 25) {
    if (!supabaseClient) return [];
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('username, coins, torso_color, head_color, hat')
        .order('coins', { ascending: false })
        .limit(limit);

      if (error) {
        window.logDB('ERROR', `Leaderboard fetch error: ${error.message}`);
        return [];
      }
      return data || [];
    } catch (err) {
      window.logDB('ERROR', `Leaderboard exception: ${err.message}`);
      return [];
    }
  }
};