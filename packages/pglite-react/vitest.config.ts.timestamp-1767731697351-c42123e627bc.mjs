// vitest.config.ts
import { defineConfig } from "file:///mnt/dev-data/app/nmtpathways-monorepo/node_modules/.pnpm/vitest@2.1.9_@types+node@24.10.0_happy-dom@18.0.1_jsdom@24.1.3_lightningcss@1.30.1_terser@5.44.0/node_modules/vitest/dist/config.js";
import react from "file:///mnt/dev-data/app/nmtpathways-monorepo/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@7.3.0_@types+node@24.10.0_jiti@2.6.1_lightningcss@1.30._090ae762e2de680706d6e2591d5ab785/node_modules/@vitejs/plugin-react/dist/index.js";
var vitest_config_default = defineConfig({
  plugins: [react()],
  test: {
    name: "pglite-react",
    dir: "./test",
    watch: false,
    environment: "jsdom",
    setupFiles: ["test-setup.ts"],
    typecheck: { enabled: true },
    restoreMocks: true,
    testTimeout: 15e3,
    testTransformMode: {
      ssr: ["**/*"]
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9tbnQvZGV2LWRhdGEvYXBwL25tdHBhdGh3YXlzLW1vbm9yZXBvL3BhY2thZ2VzL3BnbGl0ZS9wYWNrYWdlcy9wZ2xpdGUtcmVhY3RcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9tbnQvZGV2LWRhdGEvYXBwL25tdHBhdGh3YXlzLW1vbm9yZXBvL3BhY2thZ2VzL3BnbGl0ZS9wYWNrYWdlcy9wZ2xpdGUtcmVhY3Qvdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vbW50L2Rldi1kYXRhL2FwcC9ubXRwYXRod2F5cy1tb25vcmVwby9wYWNrYWdlcy9wZ2xpdGUvcGFja2FnZXMvcGdsaXRlLXJlYWN0L3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlc3QvY29uZmlnJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHRlc3Q6IHtcbiAgICBuYW1lOiAncGdsaXRlLXJlYWN0JyxcbiAgICBkaXI6ICcuL3Rlc3QnLFxuICAgIHdhdGNoOiBmYWxzZSxcbiAgICBlbnZpcm9ubWVudDogJ2pzZG9tJyxcbiAgICBzZXR1cEZpbGVzOiBbJ3Rlc3Qtc2V0dXAudHMnXSxcbiAgICB0eXBlY2hlY2s6IHsgZW5hYmxlZDogdHJ1ZSB9LFxuICAgIHJlc3RvcmVNb2NrczogdHJ1ZSxcbiAgICB0ZXN0VGltZW91dDogMTUwMDAsXG4gICAgdGVzdFRyYW5zZm9ybU1vZGU6IHtcbiAgICAgIHNzcjogWycqKi8qJ10sXG4gICAgfSxcbiAgfSxcbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTBaLFNBQVMsb0JBQW9CO0FBQ3ZiLE9BQU8sV0FBVztBQUVsQixJQUFPLHdCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsTUFBTTtBQUFBLElBQ0osTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGVBQWU7QUFBQSxJQUM1QixXQUFXLEVBQUUsU0FBUyxLQUFLO0FBQUEsSUFDM0IsY0FBYztBQUFBLElBQ2QsYUFBYTtBQUFBLElBQ2IsbUJBQW1CO0FBQUEsTUFDakIsS0FBSyxDQUFDLE1BQU07QUFBQSxJQUNkO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
