# VRC Worlds Manager v2 (Custom Fork)

> [!IMPORTANT]
> **This is a forked version** of [Raifa21/VRC-Worlds-Manager-v2](https://github.com/Raifa21/VRC-Worlds-Manager-v2) with additional features.
> 
> See [CHANGELOG_CUSTOM.md](./CHANGELOG_CUSTOM.md) for a list of modifications.

[日本語はこちら / 日本語のREADMEはREADME.mdを参照してください。](./README.md)

---

## Custom Features (Fork)

This fork adds the following features:

- ⭐ **Favorite Button** - Mark worlds as favorites with a star button
- 📏 **Window Size Persistence** - Remembers window size and position
- 🎯 **Default Instance Type** - Set default instance type in settings
- 🔀 **Folder Drag & Drop** - Reorder folders by dragging
- 📤 **Native Export** - Export data compatible with the original VRC Worlds Manager v2
- ✨ **Custom Branding** - Updated branding and About page
- 📝 **Enhanced Logging** - Better debugging for folder operations

---

## Original Features

VRC Worlds Manager is a Windows application designed to help VRChat users organize and store their favorite worlds more easily.

---

## Features

- Add Favourite Worlds
  - Automatically fetch worlds marked as Favourites on VRChat using the API and save them in the app.
  - Once saved, the worlds will remain in the app even if removed from your VRChat Favourites.
  - You can also add worlds directly using their URL links.

- Organize Worlds into Folders
  - Organize saved worlds into folders.
  - A single world can be assigned to multiple folders.

- View World Details
  - Check the details of a world from within the app.
  - You can also attach notes to each world.

- Search Function
  - Search through saved worlds in the app.
  - Supports searching by world creator, tags, and folders.

- Discover Worlds
  - Retrieve a list of recently visited worlds.
  - Search for worlds using tags, text, exclusion tags, and more.

- Create Instances
  - Generate instances directly from the app. Group instances can also be created.
  - When an instance is created, an invite will be sent, just like on the official VRChat website.

- Share Folders
  - Share folders and generate a UUID valid for 30 days.
  - Folders can also be viewed on the web.

---

## Screenshots

![image](https://github.com/user-attachments/assets/13e36a5b-0ea4-4d80-ba9d-ed7dde811abd)

![image](https://github.com/user-attachments/assets/5b30cca7-b62c-4f11-b342-2ebbabcf0089)

![image](https://github.com/user-attachments/assets/94a6ed0e-2828-484e-99d4-17fc9039fc44)

![image](https://github.com/user-attachments/assets/8f567d9d-49eb-4e6b-a6d2-f65bf08cda84)

![image](https://github.com/user-attachments/assets/d45f8363-b5d7-4a3b-8a94-d4cd39fdb372)



---

## Chrome Extension

This project includes a Chrome extension for enhanced integration.

### Features
- **Context Menu Search**: Search for selected text in VRC Worlds Manager directly from the browser context menu.
- **Deep Link Support**: Handles deep links for better VRChat integration.

### Installation
1. Go to `chrome://extensions/` in Chrome.
2. Enable "Developer mode" in the top right.
3. Click "Load unpacked" and select the `browser-extension` folder in this repository.

---

## Installation

Download the latest release from the Releases page of this repository and run the `.exe` file.  
No additional setup is required.

---

## Build/Release

This project uses [Tauri](https://tauri.app/) and [Next.js](https://nextjs.org/).  
To build from source, clone the repository and follow the instructions in the [Tauri documentation](https://tauri.app/v1/guides/getting-started/prerequisites/) and [Next.js documentation](https://nextjs.org/docs).

---

## Contributing

Contributions are welcome!  
See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

This project is licensed under the MIT License. See the [LICENCE](LICENCE) file for details.

Some components are licensed under [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) and are for non-commercial use only. See the [LICENSE_ADDITIONAL](LICENSE_ADDITIONAL) file for details.

---

## Credits

- Special thanks to VRChat and the VRChat API Community for providing API documentation.
- VRChat-like sidebar icons provided by 黒音キト, licensed under CC-BY-NC-4.0.
- Application icon uses Ciel-chan, with thanks to ArmoireLepus for approval to use.
