describe('Fetch Script Tests', () => {
  beforeEach(() => {
    console.log('Before each...');
  });

  afterEach(() => {
    console.log('...after each');
  });

  describe('Test', () => {
    it('should launch', () => {
      const value = true;

      expect(value).toBe(true);
    });
  });
});
