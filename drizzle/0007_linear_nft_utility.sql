-- Preserve operator freezes while giving the linear runtime its own write guard.
-- Activation permanently freezes season_phase and season_phase_v2 so older
-- deployments cannot award legacy points or use exponential NFT multipliers.
INSERT INTO game_settings(key,value) SELECT 'season_phase_v3',value FROM game_settings WHERE key='season_phase_v2' ON CONFLICT(key) DO NOTHING;
