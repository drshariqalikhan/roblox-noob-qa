/**
 * supabase.js - Reads credentials injected dynamically from the environment
 */

const SUPABASE_URL = (window.ENV && window.ENV.SUPABASE_URL) || "";
const SUPABASE_ANON_KEY = (window.ENV && window.ENV.SUPABASE_ANON_KEY) || "";

// Initialize Supabase Client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DB = {
  getDeviceId() {
    let devId = localStorage.getItem('roblox_noob_device_uid');
    if (!devId) {
      devId = (window.crypto && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('roblox_noob_device_uid', devId);
    }
    return devId;
  },

  async getDeviceProfile() {
    const deviceId = this.getDeviceId();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching device profile:", error);
      return null;
    }
    return data;
  },

  async registerDeviceProfile(characterData) {
    const deviceId = this.getDeviceId();
    const { data, error } = await supabase
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

    if (error) throw error;
    return data;
  },

  async updateAttributes(updates) {
    const deviceId = this.getDeviceId();
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('device_id', deviceId)
      .select()
      .single();

    if (error) {
      console.error("Failed to save attributes to Supabase:", error);
    }
    return data;
  }
};

window.DB = DB;