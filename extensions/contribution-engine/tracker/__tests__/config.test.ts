describe('tracker config', () => {
    const originalEnv = { ...process.env };

    function setRequiredProgramEnv() {
        process.env.CONTRIBUTION_ENGINE_PROGRAM_ID = 'Contribution1111111111111111111111111111111';
        process.env.IDENTITY_REGISTRY_PROGRAM_ID = 'Identity11111111111111111111111111111111111';
        process.env.REGISTRY_FACTORY_PROGRAM_ID = 'Factory111111111111111111111111111111111111';
        process.env.EVENT_EMITTER_PROGRAM_ID = 'Event11111111111111111111111111111111111111';
    }

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
    });

    it('defaults identityRegistryName to social_hub_identity', async () => {
        setRequiredProgramEnv();
        delete process.env.IDENTITY_REGISTRY_NAME;

        const { loadConfig } = await import('../src/config');
        const config = loadConfig();

        expect(config.identityRegistryName).toBe('social_hub_identity');
    });

    it('honors IDENTITY_REGISTRY_NAME override', async () => {
        setRequiredProgramEnv();
        process.env.IDENTITY_REGISTRY_NAME = 'custom_identity_registry';

        const { loadConfig } = await import('../src/config');
        const config = loadConfig();

        expect(config.identityRegistryName).toBe('custom_identity_registry');
    });

    it('requires explicit Program ID env instead of silently falling back to baked-in defaults', async () => {
        delete process.env.CONTRIBUTION_ENGINE_PROGRAM_ID;
        delete process.env.IDENTITY_REGISTRY_PROGRAM_ID;
        delete process.env.REGISTRY_FACTORY_PROGRAM_ID;
        delete process.env.EVENT_EMITTER_PROGRAM_ID;

        const { loadConfig } = await import('../src/config');

        expect(() => loadConfig()).toThrow('Missing required tracker env: CONTRIBUTION_ENGINE_PROGRAM_ID');
    });
});
