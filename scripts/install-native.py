#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Trusted-checkout entry point; never download and execute an unpinned script."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = '22.23.4'
HASHES = {
    'x86_64': ('x64', '1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce'),
    'aarch64': ('arm64', '6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b'),
}
# Pinned from https://nodejs.org/dist/v22.23.4/SHASUMS256.txt.
# A runtime version change requires reviewing both architecture hashes.
MAX_DOWNLOAD = 80 * 1024 * 1024
MAX_EXPANDED = 400 * 1024 * 1024


def read_authority(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or
                info.st_nlink != 1 or info.st_mode & 0o022 or info.st_size > 65536):
            raise ValueError('unsafe_install_authority')
        return json.loads(file.read(65537))


def require_ready(record):
    checks = record.get('checks')
    if (record.get('schemaVersion') != 1 or record.get('ownerDecision') != 'D-53' or
            record.get('readyForOwnerInstallation') is not True or
            record.get('ownerDeploymentConsentRecorded') is not True or
            not isinstance(checks, dict) or not checks or
            any(not key or value is not True for key, value in checks.items())):
        raise ValueError('installation_gate_closed')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('runtime_redirect_refused')


def download_runtime(destination, arch):
    name = f'node-v{VERSION}-linux-{arch}.tar.xz'
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(f'https://nodejs.org/dist/v{VERSION}/{name}', timeout=30) as response:
        if response.status != 200:
            raise ValueError('runtime_download_failed')
        total = 0
        with destination.open('xb') as file:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_DOWNLOAD:
                    raise ValueError('runtime_download_too_large')
                file.write(chunk)
        if not total:
            raise ValueError('runtime_download_empty')


def extract_runtime(archive, destination, arch, expected_hash):
    with archive.open('rb') as file:
        if hashlib.file_digest(file, 'sha256').hexdigest() != expected_hash:
            raise ValueError('runtime_checksum_mismatch')
    prefix = f'node-v{VERSION}-linux-{arch}'
    with tarfile.open(archive, 'r:xz') as bundle:
        members, total, names = [], 0, set()
        for entry in bundle:
            path = PurePosixPath(entry.name)
            if (path.is_absolute() or '..' in path.parts or not path.parts or
                    path.parts[0] != prefix or entry.name in names or
                    not (entry.isfile() or entry.isdir() or entry.issym())):
                raise ValueError('runtime_archive_unsafe')
            names.add(entry.name)
            total += entry.size
            if total > MAX_EXPANDED or len(names) > 20000:
                raise ValueError('runtime_archive_too_large')
            if entry.issym():
                target = (destination / path.parent / entry.linkname).resolve()
                if not target.is_relative_to((destination / prefix).resolve()):
                    raise ValueError('runtime_link_unsafe')
            members.append(entry)
        # Python 3.12 data filter additionally rejects links outside extraction.
        bundle.extractall(destination, members=members, filter='data')
    root = destination / prefix
    for path in root.rglob('*'):
        if not path.is_symlink():
            os.chmod(path, 0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)
    os.chmod(root, 0o755)
    for name in ['bin/node', 'bin/npm']:
        if not (root / name).resolve().is_relative_to(root.resolve()) or not (root / name).is_file():
            raise ValueError('runtime_executables_missing')
    return root


def provision_runtime(target=Path('/opt/node')):
    arch, digest = HASHES[platform.machine()]
    # /opt/node is reserved for this bootstrap. Existing installations are
    # reused only with our exact receipt; unrelated runtimes are never replaced.
    receipt = {'version': VERSION, 'architecture': arch, 'sha256': digest}
    parent = target.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
        raise ValueError('unsafe_runtime_parent')
    if target.exists() or target.is_symlink():
        info = target.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('unsafe_runtime_directory')
        if target.is_symlink() or read_authority(target / '.domyro-runtime.json') != receipt:
            raise ValueError('existing_node_runtime_not_owned')
        if subprocess.check_output([str(target / 'bin/node'), '--version'], text=True).strip() != 'v' + VERSION:
            raise ValueError('existing_node_runtime_changed')
        return
    # Same filesystem as target for atomic publication; no partial runtime at
    # /opt/node is visible after download/extraction failures.
    with tempfile.TemporaryDirectory(prefix='.domyro-runtime-', dir=target.parent) as tmp:
        stage = Path(tmp)
        archive = stage / 'node.tar.xz'
        download_runtime(archive, arch)
        root = extract_runtime(archive, stage, arch, digest)
        if subprocess.check_output([str(root / 'bin/node'), '--version'], text=True).strip() != 'v' + VERSION:
            raise ValueError('runtime_version_mismatch')
        marker = root / '.domyro-runtime.json'
        with marker.open('x') as file:
            json.dump(receipt, file)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(marker, 0o600)
        os.rename(root, target)
        fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--install', action='store_true', required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--version')
    source.add_argument('--directory', type=Path)
    parser.add_argument('--publisher-policy', type=Path, required=True)
    parser.add_argument('--readiness', type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('root_required')
    osinfo = platform.freedesktop_os_release()
    if (osinfo.get('ID') != 'ubuntu' or osinfo.get('VERSION_ID') != '24.04' or
            not Path('/run/systemd/system').is_dir() or Path('/.dockerenv').exists()):
        raise ValueError('native_ubuntu_24_04_required')
    if platform.machine() not in HASHES:
        raise ValueError('unsupported_architecture')
    for path in [args.publisher_policy, args.readiness, *([args.directory] if args.directory else [])]:
        if not path.is_absolute():
            raise ValueError('absolute_paths_required')
    if args.version and (len(args.version) > 80 or '..' in args.version or not re.fullmatch(
            r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?', args.version)):
        raise ValueError('release_version_invalid')
    require_ready(read_authority(args.readiness))
    if read_authority(args.publisher_policy).get('configured') is not True:
        raise ValueError('publisher_not_configured')
    lockfd = os.open('/run/lock/domyro-bootstrap.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lockfd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        provision_runtime()
        env = {'PATH': '/opt/node/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
        command = ['/opt/node/bin/node', str(Path(__file__).resolve().with_name('install-native-source.mjs')),
                   '--install', '--publisher-policy=' + str(args.publisher_policy), '--readiness=' + str(args.readiness)]
        command.append('--directory=' + str(args.directory) if args.directory else '--version=' + args.version)
        subprocess.run(command, env=env, check=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not expose signed URL parameters or authority file contents.
        safe = {'unsafe_install_authority', 'installation_gate_closed', 'runtime_redirect_refused',
                'runtime_download_failed', 'runtime_download_too_large', 'runtime_download_empty',
                'runtime_checksum_mismatch', 'runtime_archive_unsafe', 'runtime_archive_too_large',
                'runtime_link_unsafe', 'runtime_executables_missing', 'unsafe_runtime_parent',
                'unsafe_runtime_directory', 'existing_node_runtime_not_owned', 'existing_node_runtime_changed',
                'runtime_version_mismatch', 'root_required', 'native_ubuntu_24_04_required',
                'unsupported_architecture', 'absolute_paths_required', 'release_version_invalid',
                'publisher_not_configured'}
        reason = str(error) if str(error) in safe else type(error).__name__
        print('Domyro bootstrap refused or interrupted: ' + reason, file=__import__('sys').stderr)
        raise SystemExit(1)
