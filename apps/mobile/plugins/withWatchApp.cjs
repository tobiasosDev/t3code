"use strict";

// Adds the T3 Code Apple Watch companion (apps/mobile/watch/T3Watch) as a watchOS app target
// embedded in the iOS app. Fork addition: everything lives in this plugin and the watch folder.

const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET_NAME = "T3Watch";
const DISPLAY_NAME = "T3 Code";
const WATCHOS_DEPLOYMENT_TARGET = "26.0";
const SOURCE_DIR = path.join(__dirname, "..", "watch", TARGET_NAME);

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function listSourceEntries() {
  return fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".swift") || name.endsWith(".xcassets"))
    .sort();
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

function withWatchSources(config, { iconPath }) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME);
      fs.rmSync(targetDir, { recursive: true, force: true });
      copyDirectory(SOURCE_DIR, targetDir);
      if (iconPath) {
        fs.copyFileSync(
          path.resolve(cfg.modRequest.projectRoot, iconPath),
          path.join(targetDir, "Assets.xcassets", "AppIcon.appiconset", "AppIcon.png"),
        );
      }
      return cfg;
    },
  ]);
}

function section(objects, name) {
  objects[name] ??= {};
  return objects[name];
}

function add(objects, sectionName, uuid, value, comment) {
  const target = section(objects, sectionName);
  target[uuid] = value;
  target[`${uuid}_comment`] = comment;
}

function entries(sectionObject) {
  return Object.entries(sectionObject ?? {}).filter(([key]) => !key.endsWith("_comment"));
}

function buildSettings({ iosBundleIdentifier, marketingVersion, buildNumber, appleTeamId, debug }) {
  return {
    ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
    ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: "AccentColor",
    CODE_SIGN_STYLE: "Automatic",
    CURRENT_PROJECT_VERSION: quote(buildNumber),
    ...(appleTeamId ? { DEVELOPMENT_TEAM: appleTeamId } : {}),
    ENABLE_PREVIEWS: "YES",
    GENERATE_INFOPLIST_FILE: "YES",
    INFOPLIST_KEY_CFBundleDisplayName: quote(DISPLAY_NAME),
    INFOPLIST_KEY_WKCompanionAppBundleIdentifier: quote(iosBundleIdentifier),
    INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp: "NO",
    LD_RUNPATH_SEARCH_PATHS: quote("$(inherited) @executable_path/Frameworks"),
    MARKETING_VERSION: quote(marketingVersion),
    PRODUCT_BUNDLE_IDENTIFIER: quote(`${iosBundleIdentifier}.watchkitapp`),
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

function withWatchTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const objects = project.hash.project.objects;
    const rootUuid = project.hash.project.rootObject;
    const pbxProject = objects.PBXProject[rootUuid];

    if (entries(objects.PBXNativeTarget).some(([, target]) => target.name === TARGET_NAME)) {
      return cfg;
    }

    const projectName = cfg.modRequest.projectName;
    const mainEntry = entries(objects.PBXNativeTarget).find(
      ([, target]) => target.name === projectName || target.name === quote(projectName),
    );
    if (!mainEntry) {
      throw new Error(`withWatchApp: could not find the iOS app target "${projectName}".`);
    }
    const [, mainTarget] = mainEntry;

    const iosBundleIdentifier = cfg.ios?.bundleIdentifier;
    if (!iosBundleIdentifier) {
      throw new Error("withWatchApp: ios.bundleIdentifier is required.");
    }

    const groupChildren = [];
    const sourceBuildFiles = [];
    const resourceBuildFiles = [];
    for (const name of listSourceEntries()) {
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
      { isa: "PBXGroup", children: groupChildren, path: TARGET_NAME, sourceTree: quote("<group>") },
      TARGET_NAME,
    );
    objects.PBXGroup[pbxProject.mainGroup].children.push({
      value: groupUuid,
      comment: TARGET_NAME,
    });

    const productRef = project.generateUuid();
    add(
      objects,
      "PBXFileReference",
      productRef,
      {
        isa: "PBXFileReference",
        explicitFileType: "wrapper.application",
        includeInIndex: 0,
        path: `${TARGET_NAME}.app`,
        sourceTree: "BUILT_PRODUCTS_DIR",
      },
      `${TARGET_NAME}.app`,
    );
    const productsGroup = entries(objects.PBXGroup).find(([, group]) => group.name === "Products");
    if (productsGroup) {
      productsGroup[1].children.push({ value: productRef, comment: `${TARGET_NAME}.app` });
    }

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
    const buildPhases = [
      phase("PBXSourcesBuildPhase", "Sources", sourceBuildFiles),
      phase("PBXFrameworksBuildPhase", "Frameworks", []),
      phase("PBXResourcesBuildPhase", "Resources", resourceBuildFiles),
    ];

    const marketingVersion = cfg.ios?.version ?? cfg.version ?? "1.0.0";
    const buildNumber = cfg.ios?.buildNumber ?? "1";
    const appleTeamId = cfg.ios?.appleTeamId;
    const configurations = ["Debug", "Release"].map((name) => {
      const uuid = project.generateUuid();
      add(
        objects,
        "XCBuildConfiguration",
        uuid,
        {
          isa: "XCBuildConfiguration",
          buildSettings: buildSettings({
            iosBundleIdentifier,
            marketingVersion,
            buildNumber,
            appleTeamId,
            debug: name === "Debug",
          }),
          name,
        },
        name,
      );
      return { value: uuid, comment: name };
    });
    const configurationListUuid = project.generateUuid();
    const configurationListComment = `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`;
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
    add(
      objects,
      "PBXNativeTarget",
      targetUuid,
      {
        isa: "PBXNativeTarget",
        buildConfigurationList: configurationListUuid,
        buildConfigurationList_comment: configurationListComment,
        buildPhases,
        buildRules: [],
        dependencies: [],
        name: TARGET_NAME,
        productName: TARGET_NAME,
        productReference: productRef,
        productReference_comment: `${TARGET_NAME}.app`,
        productType: quote("com.apple.product-type.application"),
      },
      TARGET_NAME,
    );
    pbxProject.targets.push({ value: targetUuid, comment: TARGET_NAME });
    pbxProject.attributes ??= {};
    pbxProject.attributes.TargetAttributes ??= {};
    pbxProject.attributes.TargetAttributes[targetUuid] = { CreatedOnToolsVersion: "26.0" };

    // Embed the watch app in the iOS app and build it first.
    const embedBuildFile = project.generateUuid();
    add(
      objects,
      "PBXBuildFile",
      embedBuildFile,
      {
        isa: "PBXBuildFile",
        fileRef: productRef,
        fileRef_comment: `${TARGET_NAME}.app`,
        settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
      },
      `${TARGET_NAME}.app in Embed Watch Content`,
    );
    const embedPhaseUuid = project.generateUuid();
    add(
      objects,
      "PBXCopyFilesBuildPhase",
      embedPhaseUuid,
      {
        isa: "PBXCopyFilesBuildPhase",
        buildActionMask: 2147483647,
        dstPath: quote("$(CONTENTS_FOLDER_PATH)/Watch"),
        dstSubfolderSpec: 16,
        files: [{ value: embedBuildFile, comment: `${TARGET_NAME}.app in Embed Watch Content` }],
        name: quote("Embed Watch Content"),
        runOnlyForDeploymentPostprocessing: 0,
      },
      "Embed Watch Content",
    );
    mainTarget.buildPhases.push({ value: embedPhaseUuid, comment: "Embed Watch Content" });

    const proxyUuid = project.generateUuid();
    add(
      objects,
      "PBXContainerItemProxy",
      proxyUuid,
      {
        isa: "PBXContainerItemProxy",
        containerPortal: rootUuid,
        containerPortal_comment: "Project object",
        proxyType: 1,
        remoteGlobalIDString: targetUuid,
        remoteInfo: TARGET_NAME,
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
        target: targetUuid,
        target_comment: TARGET_NAME,
        targetProxy: proxyUuid,
        targetProxy_comment: "PBXContainerItemProxy",
      },
      "PBXTargetDependency",
    );
    mainTarget.dependencies.push({ value: dependencyUuid, comment: "PBXTargetDependency" });

    return cfg;
  });
}

module.exports = function withWatchApp(config, options = {}) {
  config = withWatchTarget(config);
  return withWatchSources(config, options);
};
