/** DataTransfer.types にファイルが含まれるか。dragenter 時点では中身を読めないため型で見る。 */
export function isFileDrag(types: readonly string[]): boolean {
  return types.includes("Files");
}

/**
 * dragleave が受け口の外へ出たときのものか。子要素の間を移るたびに
 * dragleave が出るので、移った先が受け口の内側なら表示を消さない。
 */
export function leftDropZone(
  zone: { contains(node: unknown): boolean },
  relatedTarget: unknown
): boolean {
  return relatedTarget === null || !zone.contains(relatedTarget);
}
