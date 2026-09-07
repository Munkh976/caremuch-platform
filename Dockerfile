# Multi-stage build for the Vite/React app. Vite bakes VITE_* env vars into the
# bundled JS at BUILD time -- there is no runtime env step for a static build, so
# these must be passed as --build-arg at `docker build`/`flyctl deploy` time, not as
# Fly runtime secrets (a Fly secret set after this image is built would have zero
# effect on the already-baked static files).

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Only the three VITE_ vars actually read anywhere in src/ (confirmed via
# `grep -r "import.meta.env" src/`: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
# VITE_SUPABASE_PROJECT_ID). No service-role or other secret belongs here -- this
# entire image, including its build args, ends up in a public static bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- serve stage ----
FROM nginx:alpine AS serve

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
