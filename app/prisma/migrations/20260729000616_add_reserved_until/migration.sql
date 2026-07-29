/*
  Warnings:

  - Added the required column `reservedUntil` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reservedUntil" TIMESTAMP(3) NOT NULL;
