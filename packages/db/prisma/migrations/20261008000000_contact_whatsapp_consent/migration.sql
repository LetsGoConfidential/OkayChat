CREATE TYPE "WhatsappConsent" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

ALTER TABLE "Contact"
ADD COLUMN "whatsappConsent" "WhatsappConsent" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "whatsappConsentAt" TIMESTAMP(3),
ADD COLUMN "whatsappConsentSource" TEXT;
