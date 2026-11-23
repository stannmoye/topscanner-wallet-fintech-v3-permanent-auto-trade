import type { DeskEconomics, DeskKey } from "@shared/investment-economics";
import { getTreasuryBondCatalogue } from "@shared/treasury-bond-catalogue";
import { getLitigationFundsCatalogue } from "@shared/litigation-funds-catalogue";
import { getAgroInvestmentCatalogue } from "@shared/agro-investment-catalogue";
import { getIpRoyaltiesCatalogue } from "@shared/ip-royalties-catalogue";
import { getMusicRoyaltiesCatalogue } from "@shared/music-royalties-catalogue";
import { getCooperateDeptCatalogue } from "@shared/cooperate-dept-catalogue";
import { getCarbonInvestmentCatalogue } from "@shared/carbon-credit-catalogue";
import { getGreenEnergyInvestmentCatalogue } from "@shared/green-energy-catalogue";
import { listEnabledAdminTreasuryBondInstruments } from "./treasuryBondInstruments";
import { listEnabledAdminLitigationDossiers } from "./litigationFundDossiers";
import { listEnabledAdminAgroDossiers } from "./agroInvestmentDossiers";
import { listEnabledAdminIpRoyaltyDossiers } from "./ipRoyaltiesDossiers";
import { listEnabledAdminMusicDossiers } from "./musicRoyaltyDossiers";
import { listEnabledAdminCooperateDeptCompanies } from "./cooperateDeptCompanies";
import { listEnabledAdminCarbonDossiers } from "./carbonCreditDossiers";
import { listEnabledAdminGreenEnergyDossiers } from "./greenEnergyDossiers";
import { getDeskEconomicsMap, listDeskEconomics } from "./deskEconomics";

/** Collect the ids of one live list, tolerating a failed source. */
async function idsFrom(label: string, load: () => Promise<Array<{ id: string }>>): Promise<string[]> {
  try {
    return (await load()).map((item) => String(item.id));
  } catch (error) {
    console.error(`[DeskEconomicsSync] Failed to read ${label}:`, error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * The instrument ids one desk actually serves, gathered from the same live
 * catalogue plus enabled administrator records that its customer dashboard
 * merges. Each source is read independently and fails soft, so one unreachable
 * provider never blanks the console. The id set deliberately mirrors the desk's
 * dashboard (for example the IP royalty desk's economics cover rights, not the
 * non-economic portfolios).
 */
export async function listDeskSourceInstrumentIds(desk: DeskKey): Promise<string[]> {
  const groups: string[][] = [];
  switch (desk) {
    case "treasury":
      groups.push(
        await idsFrom("Treasury administrator instruments", listEnabledAdminTreasuryBondInstruments),
        await idsFrom("Treasury catalogue", async () => (await getTreasuryBondCatalogue()).instruments),
      );
      break;
    case "litigation":
      groups.push(
        await idsFrom("Litigation administrator dossiers", listEnabledAdminLitigationDossiers),
        await idsFrom("Litigation catalogue", async () => (await getLitigationFundsCatalogue()).cases),
      );
      break;
    case "agro":
      groups.push(
        await idsFrom("Agro administrator dossiers", listEnabledAdminAgroDossiers),
        await idsFrom("Agro catalogue", async () => (await getAgroInvestmentCatalogue()).opportunities),
      );
      break;
    case "ipRoyalty":
      groups.push(
        await idsFrom("IP royalty administrator rights", listEnabledAdminIpRoyaltyDossiers),
        await idsFrom("IP royalty catalogue", async () => (await getIpRoyaltiesCatalogue()).rights),
      );
      break;
    case "music":
      groups.push(
        await idsFrom("Music administrator dossiers", listEnabledAdminMusicDossiers),
        await idsFrom("Music catalogue", async () => (await getMusicRoyaltiesCatalogue()).opportunities),
      );
      break;
    case "cooperate":
      groups.push(
        await idsFrom("Cooperate Dept administrator companies", listEnabledAdminCooperateDeptCompanies),
        await idsFrom("Cooperate Dept catalogue", async () => (await getCooperateDeptCatalogue()).companies),
      );
      break;
    case "carbon":
      groups.push(
        await idsFrom("Carbon administrator dossiers", listEnabledAdminCarbonDossiers),
        await idsFrom("Carbon catalogue", async () => (await getCarbonInvestmentCatalogue()).opportunities),
      );
      break;
    case "greenEnergy":
      groups.push(
        await idsFrom("Green Energy administrator dossiers", listEnabledAdminGreenEnergyDossiers),
        await idsFrom("Green Energy catalogue", async () => (await getGreenEnergyInvestmentCatalogue()).opportunities),
      );
      break;
  }
  return [...new Set(groups.flat().map((id) => id.trim()).filter(Boolean))];
}

/**
 * Pull one desk's live source into the economics store: assign and persist a
 * profile for every offer the desk currently serves (an existing ADMIN row is
 * left untouched), then return the desk's full stored set for the admin console.
 * This is what the console's "Load live from source" action runs, so freshly
 * fetched catalogue items appear in the edit table without waiting for a
 * customer to load the desk.
 */
export async function syncDeskEconomicsFromSource(desk: DeskKey): Promise<DeskEconomics[]> {
  const ids = await listDeskSourceInstrumentIds(desk);
  if (ids.length) {
    try {
      await getDeskEconomicsMap(desk, ids);
    } catch (error) {
      console.error("[DeskEconomicsSync] Failed to assign economics:", error instanceof Error ? error.message : "UnknownError");
    }
  }
  return listDeskEconomics(desk);
}
