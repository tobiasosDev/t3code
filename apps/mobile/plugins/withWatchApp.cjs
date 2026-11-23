"use strict";

// Adds the T3 Code Apple Watch companion (apps/mobile/watch) to the iOS app: the watchOS app
// T3Watch, embedded in the iOS app, and its widget T3WatchWidget (complications, Smart Stack),
// embedded in the watch app. Fork addition: everything lives in this plugin and the watch folder.

const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const WATCH_ROOT = path.join(__dirname, "..", "watch");
const DISPLAY_NAME = "T3 Code";
const WATCHOS_DEPLOYMENT_TARGET = "26.0";

const APP = {
  name: "T3Watch",
  productType: "com.apple.product-type.application",
  fileType: "wrapper.application",
  extension: "app",
  bundleSuffix: ".watchkitapp",
};
const WIDGET = {
  name: "T3WatchWidget",
  productType: "com.apple.product-type.app-extension",
  fileType: "wrapper.app-extension",
  extension: "appex",
  bundleSuffix: ".watchkitapp.widget",
};

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function copyDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

/** Both targets share the iOS app's group, where the watch app leaves the widget its summary. */
function appGroupEntitlements(iosBundleIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>group.${iosBundleIdentifier}</string>
  </array>
</dict>
</plist>
`;
}

function withWatchSources(config, { iconPath }) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      for (const target of [APP, WIDGET]) {
        const targetDir = path.join(cfg.modRequest.platformProjectRoot, target.name);
        fs.rmSync(targetDir, { recursive: true, force: true });
        copyDirectory(path.join(WATCH_ROOT, target.name), targetDir);
        fs.writeFileSync(
          path.join(targetDir, `${target.name}.entitlements`),
          appGroupEntitlements(cfg.ios.bundleIdentifier),
        );
      }
      if (iconPath) {
        fs.copyFileSync(
          path.resolve(cfg.modRequest.projectRoot, iconPath),
          path.join(
            cfg.modRequest.platformProjectRoot,
            APP.name,
            "Assets.xcassets",
            "AppIcon.appiconset",
            "AppIcon.png",
          ),
        );
      }
      return cfg;
    },
  ]);
}

function add(objects, sectionName, uuid, value, comment) {
  objects[sectionName] ??= {};
  objects[sectionName][uuid] = value;
  objects[sectionName][`${uuid}_comment`] = comment;
}

function entries(sectionObject) {
  return Object.entries(sectionObject ?? {}).filter(([key]) => !key.endsWith("_comment"));
}

function sharedBuildSettings({ target, iosBundleIdentifier, versions, debug }) {
  return {
    CODE_SIGN_ENTITLEMENTS: quote(`${target.name}/${target.name}.entitlements`),
    CODE_SIGN_STYLE: "Automatic",
    CURRENT_PROJECT_VERSION: quote(versions.buildNumber),
    ...(versions.appleTeamId ? { DEVELOPMENT_TEAM: versions.appleTeamId } : {}),
    GENERATE_INFOPLIST_FILE: "YES",
    INFOPLIST_KEY_CFBundleDisplayName: quote(DISPLAY_NAME),
    MARKETING_VERSION: quote(versions.marketingVersion),
    PRODUCT_BUNDLE_IDENTIFIER: quote(`${iosBundleIdentifier}${target.bundleSuffix}`),
    PRODUCT_NAME: quote("$(TARGET_NAME)"),
    SDKROOT: "watchos",
    SKIP_INSTALL: "YES",
    SUPPORTED_PLATFORMS: quote("watchos watchsimulator"),
    SWIFT_EMIT_LOC_STRINGS: "YES",
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: "4",
    WATCHOS_DEPLOYMENT_TARGET,
    ...(debug
      ? {
          SWIFT_ACTIVE_COMPILATION_CONDITIONS: quote("DEBUG $(inherited)"),
          SWIFT_OPTIMIZATION_LEVEL: quote("-Onone"),
        }
      : { SWIFT_COMPILATION_MODE: "wholemodule" }),
  };
}

function targetBuildSettings(target, iosBundleIdentifier) {
  if (target === APP) {
    return {
      ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
      ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: "AccentColor",
      ENABLE_PREVIEWS: "YES",
      INFOPLIST_KEY_WKCompanionAppBundleIdentifier: quote(iosBundleIdentifier),
      INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp: "NO",
      LD_RUNPATH_SEARCH_PATHS: quote("$(inherited) @executable_path/Frameworks"),
    };
  }
  return {
    // GENERATE_INFOPLIST_FILE merges this file, which declares the WidgetKit extension point.
    INFOPLIST_FILE: quote(`${target.name}/Info.plist`),
    LD_RUNPATH_SEARCH_PATHS: quote(
      "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks",
    ),
  };
}

function addTarget(project, cfg, target, versions) {
  const objects = project.hash.project.objects;
  const pbxProject = objects.PBXProject[project.hash.project.rootObject];
  const iosBundleIdentifier = cfg.ios.bundleIdentifier;
  const sourceNames = fs
    .readdirSync(path.join(WATCH_ROOT, target.name))
    .filter((name) => name.endsWith(".swift") || name.endsWith(".xcassets"))
    .sort();

  const groupChildren = [];
  const sourceBuildFiles = [];
  const resourceBuildFiles = [];
  for (const name of sourceNames) {
    const fileRef = project.generateUuid();
    const isAssets = name.endsWith(".xcassets");
    add(
      objects,
      "PBXFileReference",
      fileRef,
      {
        isa: "PBXFileReference",
        lastKnownFileType: isAssets ? "folder.assetcatalog" : "sourcecode.swift",
        path: quote(name),
        sourceTree: quote("<group>"),
      },
      name,
    );
    groupChildren.push({ value: fileRef, comment: name });
    const buildFile = project.generateUuid();
    const phaseName = isAssets ? "Resources" : "Sources";
    add(
      objects,
      "PBXBuildFile",
      buildFile,
      { isa: "PBXBuildFile", fileRef, fileRef_comment: name },
      `${name} in ${phaseName}`,
    );
    (isAssets ? resourceBuildFiles : sourceBuildFiles).push({
      value: buildFile,
      comment: `${name} in ${phaseName}`,
    });
  }
  const groupUuid = project.generateUuid();
  add(
    objects,
    "PBXGroup",
    groupUuid,
    { isa: "PBXGroup", children: groupChildren, path: target.name, sourceTree: quote("<group>") },
    target.name,
  );
  objects.PBXGroup[pbxProject.mainGroup].children.push({ value: groupUuid, comment: target.name });

  const productName = `${target.name}.${target.extension}`;
  const productRef = project.generateUuid();
  add(
    objects,
    "PBXFileReference",
    productRef,
    {
      isa: "PBXFileReference",
      explicitFileType: quote(target.fileType),
      includeInIndex: 0,
      path: productName,
      sourceTree: "BUILT_PRODUCTS_DIR",
    },
    productName,
  );
  const productsGroup = entries(objects.PBXGroup).find(([, group]) => group.name === "Products");
  productsGroup?.[1].children.push({ value: productRef, comment: productName });

  const phase = (isa, name, files) => {
    const uuid = project.generateUuid();
    add(
      objects,
      isa,
      uuid,
      { isa, buildActionMask: 2147483647, files, runOnlyForDeploymentPostprocessing: 0 },
      name,
    );
    return { value: uuid, comment: name };
  };

  const configurations = ["Debug", "Release"].map((name) => {
    const uuid = project.generateUuid();
    add(
      objects,
      "XCBuildConfiguration",
      uuid,
      {
        isa: "XCBuildConfiguration",
        buildSettings: {
          ...sharedBuildSettings({
            target,
            iosBundleIdentifier,
            versions,
            debug: name === "Debug",
          }),
          ...targetBuildSettings(target, iosBundleIdentifier),
        },
        name,
      },
      name,
    );
    return { value: uuid, comment: name };
  });
  const configurationListUuid = project.generateUuid();
  const configurationListComment = `Build configuration list for PBXNativeTarget "${target.name}"`;
  add(
    objects,
    "XCConfigurationList",
    configurationListUuid,
    {
      isa: "XCConfigurationList",
      buildConfigurations: configurations,
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: "Release",
    },
    configurationListComment,
  );

  const targetUuid = project.generateUuid();
  const nativeTarget = {
    isa: "PBXNativeTarget",
    buildConfigurationList: configurationListUuid,
    buildConfigurationList_comment: configurationListComment,
    buildPhases: [
      phase("PBXSourcesBuildPhase", "Sources", sourceBuildFiles),
      phase("PBXFrameworksBuildPhase", "Frameworks", []),
      phase("PBXResourcesBuildPhase", "Resources", resourceBuildFiles),
    ],
    buildRules: [],
    dependencies: [],
    name: target.name,
    productName: target.name,
    productReference: productRef,
    productReference_comment: productName,
    productType: quote(target.productType),
  };
  add(objects, "PBXNativeTarget", targetUuid, nativeTarget, target.name);
  pbxProject.targets.push({ value: targetUuid, comment: target.name });
  pbxProject.attributes ??= {};
  pbxProject.attributes.TargetAttributes ??= {};
  pbxProject.attributes.TargetAttributes[targetUuid] = { CreatedOnToolsVersion: "26.0" };
  return { uuid: targetUuid, nativeTarget, productRef, productName };
}

/** Copies `child`'s product into `host` and makes `host` build it first. */
function embed(project, host, child, { phaseName, dstPath, dstSubfolderSpec }) {
  const objects = project.hash.project.objects;
  const buildFile = project.generateUuid();
  add(
    objects,
    "PBXBuildFile",
    buildFile,
    {
      isa: "PBXBuildFile",
      fileRef: child.productRef,
      fileRef_comment: child.productName,
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
    },
    `${child.productName} in ${phaseName}`,
  );
  const phaseUuid = project.generateUuid();
  add(
    objects,
    "PBXCopyFilesBuildPhase",
    phaseUuid,
    {
      isa: "PBXCopyFilesBuildPhase",
      buildActionMask: 2147483647,
      dstPath: quote(dstPath),
      dstSubfolderSpec,
      files: [{ value: buildFile, comment: `${child.productName} in ${phaseName}` }],
      name: quote(phaseName),
      runOnlyForDeploymentPostprocessing: 0,
    },
    phaseName,
  );
  host.buildPhases.push({ value: phaseUuid, comment: phaseName });

  const proxyUuid = project.generateUuid();
  add(
    objects,
    "PBXContainerItemProxy",
    proxyUuid,
    {
      isa: "PBXContainerItemProxy",
      containerPortal: project.hash.project.rootObject,
      containerPortal_comment: "Project object",
      proxyType: 1,
      remoteGlobalIDString: child.uuid,
      remoteInfo: child.nativeTarget.name,
    },
    "PBXContainerItemProxy",
  );
  const dependencyUuid = project.generateUuid();
  add(
    objects,
    "PBXTargetDependency",
    dependencyUuid,
    {
      isa: "PBXTargetDependency",
      target: child.uuid,
      target_comment: child.nativeTarget.name,
      targetProxy: proxyUuid,
      targetProxy_comment: "PBXContainerItemProxy",
    },
    "PBXTargetDependency",
  );
  host.dependencies.push({ value: dependencyUuid, comment: "PBXTargetDependency" });
}

function withWatchTargets(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const objects = project.hash.project.objects;
    if (entries(objects.PBXNativeTarget).some(([, target]) => target.name === APP.name)) {
      return cfg;
    }
    if (!cfg.ios?.bundleIdentifier) {
      throw new Error("withWatchApp: ios.bundleIdentifier is required.");
    }
    const projectName = cfg.modRequest.projectName;
    const iosTarget = entries(objects.PBXNativeTarget).find(
      ([, target]) => target.name === projectName || target.name === quote(projectName),
    )?.[1];
    if (!iosTarget) {
      throw new Error(`withWatchApp: could not find the iOS app target "${projectName}".`);
    }

    const versions = {
      marketingVersion: cfg.ios.version ?? cfg.version ?? "1.0.0",
      buildNumber: cfg.ios.buildNumber ?? "1",
      appleTeamId: cfg.ios.appleTeamId,
    };
    const watchApp = addTarget(project, cfg, APP, versions);
    const widget = addTarget(project, cfg, WIDGET, versions);
    // Not "Embed Foundation Extensions": iOS extension plugins look that phase up by name.
    embed(project, watchApp.nativeTarget, widget, {
      phaseName: "Embed Watch Widget",
      dstPath: "",
      dstSubfolderSpec: 13,
    });
    embed(project, iosTarget, watchApp, {
      phaseName: "Embed Watch Content",
      dstPath: "$(CONTENTS_FOLDER_PATH)/Watch",
      dstSubfolderSpec: 16,
    });
    return cfg;
  });
}

module.exports = function withWatchApp(config, options = {}) {
  config = withWatchTargets(config);
  return withWatchSources(config, options);
};
