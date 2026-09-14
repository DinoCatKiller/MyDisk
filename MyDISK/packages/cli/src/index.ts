import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  adminAddCommand,
  adminListCommand,
  adminRemoveCommand,
  runAdminAdd,
  runAdminList,
} from "./commands/admin";
import { dbGenerateCommand, dbPushCommand, dbStudioCommand } from "./commands/db";
import { installCommand, runInstall } from "./commands/install";
import { passwdCommand, runPasswd } from "./commands/passwd";
import { openapiCommand, runServe, serveCommand } from "./commands/serve";
import { pushSchema } from "./lib/bootstrap";
import { loadCliEnv } from "./lib/env";
import { pickMainMenuAction } from "./lib/prompts";

/** 无参数时进入交互式主菜单 */
async function showMainMenu(): Promise<void> {
  console.log("MyDisk 运维工具");
  console.log("========================================");

  const action = await pickMainMenuAction();

  switch (action) {
    case "install":
      await runInstall({});
      break;
    case "passwd":
      await runPasswd({});
      break;
    case "admin:add":
      await runAdminAdd({});
      break;
    case "admin:list":
      await runAdminList();
      break;
    case "db:push": {
      const result = pushSchema(loadCliEnv());
      console.log(result.output);
      break;
    }
    case "serve":
      runServe();
      break;
    case "exit":
    default:
      console.log("已退出");
      break;
  }
}

const cli = yargs(hideBin(process.argv))
  .scriptName("pstorage")
  .usage("$0 <command> [options]")
  .command(installCommand)
  .command(passwdCommand)
  .command(adminAddCommand)
  .command(adminListCommand)
  .command(adminRemoveCommand)
  .command(dbPushCommand)
  .command(dbGenerateCommand)
  .command(dbStudioCommand)
  .command(serveCommand)
  .command(openapiCommand)
  .command({
    command: "$0",
    describe: "显示交互式主菜单",
    handler: () => showMainMenu(),
  })
  .demandCommand(0, 0)
  .strict()
  .help()
  .alias("h", "help")
  .version(false)
  .wrap(Math.min(100, process.stdout.columns ?? 100));

await cli.parse();
