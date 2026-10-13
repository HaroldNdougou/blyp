/**
 * expo-file-system — import sync unique.
 * ChatThread importe ce module pour l’avoir dans le bundle principal ;
 * cache/upload lazy ne cassent pas Metro (IDs de modules async).
 */
import * as FileSystem from "expo-file-system/legacy";

export default FileSystem;
