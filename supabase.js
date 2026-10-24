/**
 * supabase.js - Robust Database & Diagnostic Manager
 */

// 1. Ensure global log array is always initialized
window.DB_LOGS = window.DB_LOGS || [];

window.logDB = function(level, message, data = null) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    level: level, // 'INFO', 'SUCCESS', 'WARN', 'ERROR'
    message: message,
    data: data
  };
  window.DB_LOGS.push(entry);
  console.log(`[DB ${level}] ${message}`, data || '');

  if (typeof window.onNewDBLog === 'function') {
    window.onNewDBLog(entry);
  }
};

window.logDB('INFO', 'supabase.js script loaded into browser.');

// 2. Load Supabase Credentials (uses window.ENV from server.js with direct fallback)
const DEFAULT_URL = "https://vefkmqcpoawbijynbsbl.supabase.co";
const DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlZmttcWNwb2F3YmlqeW5ic2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MTE4OTksImV4cCI6MjEwODI4Nzg5OX0.20YADd_ZmyayvXb4FUuG5T2QdUftGzI2D9-B_1O8VPA";

const SUPABASE_URL = (window.ENV && window.ENV.SUPABASE_URL && window.ENV.SUPABASE_URL.trim() !== "") 
  ? window.ENV.SUPABASE_URL.trim() 
  : DEFAULT_URL;

const SUPABASE_ANON_KEY = (window.ENV && window.ENV.SUPABASE_ANON_KEY && window.ENV.SUPABASE_ANON_KEY.trim() !== "") 
  ? window.ENV.SUPABASE_ANON_KEY.trim() 
  : DEFAULT_KEY;

// 3. Initialize Supabase Client safely
let supabaseClient = null;

try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.logDB('SUCCESS', `Supabase client created for: ${SUPABASE_URL}`);
  } else {
    window.logDB('ERROR', 'window.supabase is missing. Check if @supabase/supabase-js CDN is blocked by an adblocker.');
  }
} catch (err) {
  window.logDB('ERROR', `Failed to create Supabase client: ${err.message}`, err);
}

// 4. Attach window.DB immediately
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
      window.logDB('INFO', 'Querying table "profiles"...');
      const { data, error, status } = await supabaseClient
        .from('profiles')
        .select('device_id')
        .limit(1);

      if (error) {
        if (error.code === '42P01') {
          window.logDB('ERROR', 'FATAL: Table "profiles" does not exist in your Supabase database! Run the SQL script in Supabase SQL Editor.', error);
        } else if (error.code === '42501') {
          window.logDB('ERROR', 'RLS ERROR: Row Level Security is blocking the "anon" key. Add SELECT and INSERT policies.', error);
        } else {
          window.logDB('ERROR', `Supabase error [${error.code}]: ${error.message} (HTTP ${status})`, error);
        }
        return { ok: false, error: error.message };
      }

      window.logDB('SUCCESS', `Table "profiles" is online & accessible (HTTP ${status})!`);

      // Test current device record
      const deviceId = this.getDeviceId();
      window.logDB('INFO', `Looking up current device profile (${deviceId})...`);
      
      const { data: profile, error: pError } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (pError) {
        window.logDB('WARN', `Error querying device record: ${pError.message}`);
        return { ok: true, profile: null };
      }

      if (profile) {
        window.logDB('SUCCESS', `Profile found in DB: "${profile.username}" with ${profile.coins} coins.`);
      } else {
        window.logDB('INFO', 'No profile found for this device yet (new user).');
      }

      return { ok: true, profile };
    } catch (netErr) {
      window.logDB('ERROR', `Network connection failed: ${netErr.message}`);
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
        window.logDB('ERROR', `getDeviceProfile error: ${error.message}`);
        return null;
      }
      return data;
    } catch (e) {
      window.logDB('ERROR', `getDeviceProfile exception: ${e.message}`);
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

    window.logDB('SUCCESS', `Character "${characterData.username}" saved to database!`);
    return data;
  },

  async updateAttributes(updates) {
    if (!supabaseClient) return null;
    try {
      const deviceId = this.getDeviceId();
      window.logDB('INFO', `Updating attributes for ${deviceId}:`, updates);

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
        window.logDB('ERROR', `updateAttributes failed: ${error.message}`);
      } else {
        window.logDB('SUCCESS', 'Attributes synced with Supabase successfully.');
      }
      return data;
    } catch (e) {
      window.logDB('ERROR', `updateAttributes exception: ${e.message}`);
      return null;
    }
  }
};