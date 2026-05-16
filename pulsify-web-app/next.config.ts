import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-only "N" indicator that shows route type, bundler, and
  // build status in the bottom-left corner during `next dev`. Build/runtime
  // errors still surface normally.
  devIndicators: false,
};

export default nextConfig;
